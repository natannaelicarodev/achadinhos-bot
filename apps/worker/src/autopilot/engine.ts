// Piloto automático + fila de envio (fase 5). Tudo recebe o relógio (`now`) e as
// dependências por parâmetro: os testes simulam o tempo e o WhatsApp.
//
// Um "tick" (a cada 15 s; o piloto escolhe no máximo 1 oferta por minuto):
//   1. descarta posts que passaram do horário (nunca envia atrasado);
//   2. manual: ofertas do "Enviar para meus grupos" viram posts na fila;
//   3. piloto: para cada tenant ligado, dentro da janela e no ritmo, escolhe 1 produto;
//   4. envio: cada número conectado envia no máximo 1 post (intervalo aleatório entre envios).
import { randomBytes } from "node:crypto";
import {
  AUTO_POST_MAX_DELAY_MS,
  autopilotStores,
  channelDailyLimitFor,
  CHANNEL_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_AUTOPILOT,
  forTenant,
  getCurrentSubscription,
  isWithinWindow,
  MANUAL_POST_MAX_DELAY_MS,
  maxPriceAgeHours,
  pickIsDue,
  POST_MAX_ATTEMPTS,
  POST_RETRY_DELAYS_MS,
  randomGroupIntervalMs,
  startOfLocalDay,
  windowEndToday,
  type AutopilotSettings,
  type Prisma,
  type PrismaClient,
  type Store,
  type TenantDb,
} from "@achadinhos/db";
import {
  AffiliateLinkError,
  composeMessage,
  generateAffiliateLink,
  getMessageSettings,
  MissingCredentialError,
  type ProductRef,
} from "@achadinhos/stores";
import type { Logger } from "pino";
import { sendOfferToWhatsApp, type WhatsAppSender } from "../whatsapp/send";
import type { ImageResult } from "../whatsapp/image";

export type Settings = Pick<
  AutopilotSettings,
  | "enabled"
  | "weekdays"
  | "windowStartMinute"
  | "windowEndMinute"
  | "offersPerHour"
  | "stores"
  | "categories"
  | "minDiscountPct"
  | "minPriceCents"
  | "maxPriceCents"
  | "minRating"
  | "minCommissionPct"
  | "groupIds"
  | "repeatDays"
  | "groupIntervalMinSeconds"
  | "groupIntervalMaxSeconds"
  | "channelDailyLimit"
  | "lastPickAt"
>;

export interface AutopilotDeps {
  prisma: PrismaClient;
  logger?: Logger;
  /** Socket aberto do número neste worker (undefined = não conectado aqui). */
  getSocket: (channelId: string) => WhatsAppSender | undefined;
  /** Link de afiliado do cliente (padrão: generateAffiliateLink, fase 4b). */
  generateLink?: (tenantId: string, product: ProductRef, options: { groupId?: string }) => Promise<string>;
  loadImage?: (url: string) => Promise<ImageResult>;
  random?: () => number;
  env?: Record<string, string | undefined>;
  /** Modo acelerado (só desenvolvimento): ritmo e intervalos curtos para testar com um grupo. */
  fast?: boolean;
  /** Base do encurtador próprio (SHORT_LINK_BASE_URL ou APP_URL). Sem ela, vai o link de afiliado direto. */
  shortLinkBase?: string;
}

/** Ritmo do modo acelerado (AUTOPILOT_DEV_FAST, nunca em produção). */
export const FAST_MODE = {
  pickIntervalMs: 2 * 60_000,
  groupIntervalMinSeconds: 5,
  groupIntervalMaxSeconds: 10,
  autoPostMaxDelayMs: 10 * 60_000,
} as const;

const STATUS_QUEUED: Prisma.PostWhereInput["status"] = { in: ["SCHEDULED", "SENDING", "AWAITING_LINK"] };

/** Código do link curto (/o/{código}): 7 letras e números, um por post (= oferta + grupo). */
const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function newShortCode(length = 7): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length]).join("");
}

async function settingsOf(db: TenantDb, tenantId: string): Promise<Settings> {
  return (await db.autopilotSettings.findUnique({ where: { tenantId } })) ?? DEFAULT_AUTOPILOT;
}

/** Grupos que recebem: os escolhidos na página, ou todos com "Postar neste grupo" ligado. */
export async function targetGroups(db: TenantDb, settings: Pick<Settings, "groupIds">, options: { activeChannelsOnly?: boolean } = {}) {
  return db.group.findMany({
    where: {
      active: true,
      canSend: true,
      channel: { type: "WHATSAPP", ...(options.activeChannelsOnly ? { autopilotPausedAt: null } : {}) },
      ...(settings.groupIds.length > 0 ? { id: { in: settings.groupIds } } : { postingEnabled: true }),
    },
    select: { id: true, channelId: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Ofertas distintas com pelo menos 1 envio hoje (é isso que o maxPostsPerDay do plano conta). */
export async function offersSentToday(db: TenantDb, now: Date): Promise<string[]> {
  const rows = await db.post.groupBy({
    by: ["offerId"],
    where: { status: "SENT", sentAt: { gte: startOfLocalDay(now) } },
  });
  return rows.map((r) => r.offerId);
}

/** Mensagens enviadas hoje pelo número (é isso que o limite diário do número conta). */
export function messagesSentToday(db: TenantDb, channelId: string, now: Date) {
  return db.post.count({ where: { status: "SENT", sentAt: { gte: startOfLocalDay(now) }, group: { channelId } } });
}

async function planDailyOffers(tenantId: string, prisma: PrismaClient, now: Date): Promise<number> {
  const subscription = await getCurrentSubscription(tenantId, { client: prisma, now });
  return subscription?.plan.maxPostsPerDay ?? 0;
}

// ---------- 1. Descarte por atraso ----------

/** Posts que passaram do horário viram DESCARTADO (nunca são enviados atrasados). */
export async function discardExpiredPosts(prisma: PrismaClient, now: Date): Promise<number> {
  const { count } = await prisma.post.updateMany({
    where: { status: { in: ["SCHEDULED", "AWAITING_LINK"] }, expiresAt: { lt: now } },
    data: { status: "DISCARDED", error: "Passou do horário (fila atrasada ou janela fechada): não foi enviado." },
  });
  return count;
}

// ---------- 2. Manual ("Enviar para meus grupos") ----------

export async function queueManualOffers(deps: AutopilotDeps, now: Date): Promise<number> {
  const offers = await deps.prisma.offer.findMany({
    where: { status: "ACTIVE", sendRequestedAt: { not: null }, sendQueuedAt: null },
    take: 50,
  });
  let created = 0;
  for (const offer of offers) {
    const db = forTenant(offer.tenantId, deps.prisma);
    const settings = await settingsOf(db, offer.tenantId);
    const groups = await targetGroups(db, settings);
    const requestedAt = offer.sendRequestedAt ?? now;
    const expiresAt = new Date(requestedAt.getTime() + MANUAL_POST_MAX_DELAY_MS);
    if (groups.length === 0 && expiresAt > now) continue; // espera ligar algum grupo
    await deps.prisma.$transaction([
      ...groups.map((g) =>
        deps.prisma.post.create({
          data: {
            tenantId: offer.tenantId,
            offerId: offer.id,
            groupId: g.id,
            shortCode: newShortCode(),
            source: "MANUAL",
            status: "SCHEDULED",
            scheduledAt: now,
            expiresAt,
            store: offer.store,
            productExternalId: offer.externalId,
            messageText: offer.messageText,
            affiliateUrl: offer.affiliateUrl,
            priceCents: offer.priceCents,
            imageUrl: offer.imageUrl,
          },
        }),
      ),
      deps.prisma.offer.update({ where: { id: offer.id }, data: { sendQueuedAt: now } }),
    ]);
    created += groups.length;
  }
  return created;
}

// ---------- 3. Piloto: escolha do produto ----------

/** Lojas que no piloto só saem com link curto gerado pela extensão do cliente. */
export const SHORT_LINK_STORES: Store[] = ["MERCADO_LIVRE", "AMAZON"];

/** Extensão do cliente deu sinal de vida há pouco (gera os links curtos do ML e da Amazon no piloto). */
export const ML_EXTENSION_ONLINE_MS = 10 * 60_000;
export async function mlExtensionOnline(db: TenantDb, now: Date): Promise<boolean> {
  const token = await db.extensionToken.findFirst({
    where: { lastSeenAt: { gte: new Date(now.getTime() - ML_EXTENSION_ONLINE_MS) } },
    select: { id: true },
  });
  return token !== null;
}

/** Lojas que o piloto pode usar para o tenant: permitidas, escolhidas, com credencial e não pausadas. */
export async function usableStores(db: TenantDb, settings: Pick<Settings, "stores">, env?: Record<string, string | undefined>) {
  const allowed = autopilotStores(env);
  const wanted = settings.stores.length > 0 ? settings.stores.filter((s) => allowed.includes(s)) : allowed;
  const credentials = await db.storeCredential.findMany({
    where: { store: { in: wanted }, autopilotPausedAt: null },
    select: { store: true },
  });
  return credentials.map((c) => c.store);
}

export interface Candidate {
  product: {
    id: string;
    store: Store;
    externalId: string;
    title: string;
    productUrl: string;
    imageUrl: string | null;
    priceCents: number;
    originalPriceCents: number | null;
    discountPct: number | null;
    commissionCents: number | null;
  };
  groupIds: string[];
}

/**
 * Melhor produto (ranking) que passa nos filtros, com preço recente, de loja utilizável,
 * e que ainda não foi postado (loja + id) em pelo menos um grupo nos últimos N dias.
 */
export async function findCandidate(
  db: TenantDb,
  settings: Settings,
  stores: Store[],
  groups: { id: string }[],
  now: Date,
  env?: Record<string, string | undefined>,
): Promise<Candidate | null> {
  if (stores.length === 0 || groups.length === 0) return null;
  const freshSince = new Date(now.getTime() - maxPriceAgeHours(env) * 3_600_000);
  const repeatSince = new Date(now.getTime() - settings.repeatDays * 86_400_000);
  const where: Prisma.CatalogProductWhereInput = {
    active: true,
    store: { in: stores },
    lastSeenAt: { gte: freshSince },
    ...(settings.categories.length > 0 ? { category: { in: settings.categories } } : {}),
    ...(settings.minDiscountPct !== null ? { discountPct: { gte: settings.minDiscountPct } } : {}),
    ...(settings.minRating !== null ? { rating: { gte: settings.minRating } } : {}),
    ...(settings.minCommissionPct !== null ? { commissionPct: { gte: settings.minCommissionPct } } : {}),
    priceCents: {
      ...(settings.minPriceCents !== null ? { gte: settings.minPriceCents } : {}),
      ...(settings.maxPriceCents !== null ? { lte: settings.maxPriceCents } : {}),
    },
  };
  const groupIds = groups.map((g) => g.id);
  const PAGE = 40;
  for (let skip = 0; skip < 400; skip += PAGE) {
    const products = await db.catalogProduct.findMany({
      where,
      orderBy: [{ score: "desc" }, { id: "asc" }],
      skip,
      take: PAGE,
    });
    if (products.length === 0) return null;
    const recent = await db.post.findMany({
      where: {
        groupId: { in: groupIds },
        createdAt: { gte: repeatSince },
        status: { in: ["SCHEDULED", "SENDING", "SENT", "AWAITING_LINK"] },
        OR: products.map((p) => ({ store: p.store, productExternalId: p.externalId })),
      },
      select: { groupId: true, store: true, productExternalId: true },
    });
    const used = new Set(recent.map((r) => `${r.store}:${r.productExternalId}:${r.groupId}`));
    for (const p of products) {
      const free = groupIds.filter((g) => !used.has(`${p.store}:${p.externalId}:${g}`));
      if (free.length > 0) return { product: p, groupIds: free };
    }
  }
  return null;
}

/** Loja com credencial inválida: sai do piloto (só ela) até a credencial ser salva de novo. */
async function pauseStore(db: TenantDb, store: Store, reason: string, now: Date) {
  await db.storeCredential.updateMany({ where: { store }, data: { autopilotPausedAt: now, lastError: reason } });
}

export type PickResult =
  | { picked: true; offerId: string; posts: number }
  | { picked: false; reason: string };

/** Piloto de um tenant: escolhe 1 produto e cria a Offer + 1 Post por grupo. */
export async function pickForTenant(deps: AutopilotDeps, tenantId: string, now: Date): Promise<PickResult> {
  const db = forTenant(tenantId, deps.prisma);
  const settings = await settingsOf(db, tenantId);
  if (!settings.enabled) return { picked: false, reason: "desligado" };
  if (!isWithinWindow(settings, now)) return { picked: false, reason: "fora da janela" };
  if (!pickIsDue(settings, now, deps.fast ? FAST_MODE.pickIntervalMs : undefined)) return { picked: false, reason: "ritmo" };

  const [maxOffers, sentToday, pending] = await Promise.all([
    planDailyOffers(tenantId, deps.prisma, now),
    offersSentToday(db, now),
    db.post.groupBy({ by: ["offerId"], where: { status: STATUS_QUEUED, source: "AUTO" } }),
  ]);
  const plannedOffers = new Set([...sentToday, ...pending.map((p) => p.offerId)]);
  if (plannedOffers.size >= maxOffers) return { picked: false, reason: "limite do plano" };

  const groups = await targetGroups(db, settings, { activeChannelsOnly: true });
  const stores = await usableStores(db, settings, deps.env);
  // ML e Amazon no piloto só com LINK CURTO (meli.la / link.amazon), gerado pela extensão do
  // cliente: sem sinal de vida recente dela, essas lojas ficam de fora (só Shopee).
  const extensionOnline = await mlExtensionOnline(db, now);
  const usable = stores.filter((s) => extensionOnline || !SHORT_LINK_STORES.includes(s));
  const candidate = await findCandidate(db, settings, usable, groups, now, deps.env);
  if (!candidate) {
    await db.autopilotSettings.updateMany({ where: { tenantId }, data: { lastPickAt: now } });
    return { picked: false, reason: "nenhum produto" };
  }

  const p = candidate.product;
  const ref: ProductRef = { store: p.store, externalId: p.externalId, productUrl: p.productUrl };
  let link: string;
  try {
    link = await (deps.generateLink ?? generateAffiliateLink)(tenantId, ref, {});
  } catch (error) {
    if (error instanceof MissingCredentialError || error instanceof AffiliateLinkError) {
      await pauseStore(db, p.store, `Piloto automático pausado nesta loja: ${error.message}`, now);
      return { picked: false, reason: "credencial inválida" };
    }
    throw error;
  }
  const message = await getMessageSettings(tenantId, { client: deps.prisma });
  const text = composeMessage(
    message,
    { title: p.title, priceCents: p.priceCents, originalPriceCents: p.originalPriceCents, discountPct: p.discountPct },
    link,
    message.headline,
  );
  const maxDelay = deps.fast ? FAST_MODE.autoPostMaxDelayMs : AUTO_POST_MAX_DELAY_MS;
  const expiresAt = new Date(Math.min(now.getTime() + maxDelay, windowEndToday(settings, now).getTime()));

  const offer = await db.offer.upsert({
    where: { tenantId_catalogProductId: { tenantId, catalogProductId: p.id } },
    create: {
      tenantId,
      catalogProductId: p.id,
      store: p.store,
      externalId: p.externalId,
      title: p.title,
      url: p.productUrl,
      affiliateUrl: link,
      imageUrl: p.imageUrl,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      commissionCents: p.commissionCents,
      messageText: text,
      status: "ACTIVE",
    },
    update: {
      title: p.title,
      affiliateUrl: link,
      imageUrl: p.imageUrl,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      commissionCents: p.commissionCents,
      messageText: text,
      status: "ACTIVE",
    },
  });
  await deps.prisma.$transaction([
    ...candidate.groupIds.map((groupId) =>
      deps.prisma.post.create({
        data: {
          tenantId,
          offerId: offer.id,
          groupId,
          shortCode: newShortCode(),
          source: "AUTO",
          // ML e Amazon: esperam a extensão do cliente trocar o link longo pelo curto (nunca saem com link longo).
          status: SHORT_LINK_STORES.includes(p.store) ? "AWAITING_LINK" : "SCHEDULED",
          scheduledAt: now,
          expiresAt,
          store: p.store,
          productExternalId: p.externalId,
          messageText: text,
          affiliateUrl: link,
          priceCents: p.priceCents,
          imageUrl: p.imageUrl,
        },
      }),
    ),
    deps.prisma.autopilotSettings.update({ where: { tenantId }, data: { lastPickAt: now } }),
  ]);
  deps.logger?.info({ tenantId, offerId: offer.id, posts: candidate.groupIds.length }, "[piloto] oferta escolhida");
  return { picked: true, offerId: offer.id, posts: candidate.groupIds.length };
}

export async function runPicks(deps: AutopilotDeps, now: Date): Promise<PickResult[]> {
  const enabled = await deps.prisma.autopilotSettings.findMany({ where: { enabled: true }, select: { tenantId: true } });
  const results: PickResult[] = [];
  for (const { tenantId } of enabled) {
    try {
      results.push(await pickForTenant(deps, tenantId, now));
    } catch (error) {
      deps.logger?.error({ err: error, tenantId }, "[piloto] falha ao escolher oferta");
    }
  }
  return results;
}

// ---------- 4. Envio ----------

export type DispatchResult =
  | { channelId: string; sent: string }
  | { channelId: string; failed: string; error: string }
  | { channelId: string; skipped: string };

/** Envia no máximo 1 post do número, se a janela, os limites e o intervalo deixarem. */
export async function dispatchChannel(
  deps: AutopilotDeps,
  channel: { id: string; tenantId: string; firstConnectedAt: Date | null; createdAt: Date },
  now: Date,
): Promise<DispatchResult> {
  const db = forTenant(channel.tenantId, deps.prisma);
  const settings = await settingsOf(db, channel.tenantId);
  const skip = (why: string): DispatchResult => ({ channelId: channel.id, skipped: why });
  // Nunca envia fora da janela (posts manuais esperam; os do piloto expiram antes do fim).
  if (!isWithinWindow(settings, now)) return skip("fora da janela");
  const socket = deps.getSocket(channel.id);
  if (!socket) return skip("sem conexão neste worker");

  const post = await db.post.findFirst({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, group: { channelId: channel.id } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    include: { offer: true },
  });
  if (!post) return skip("fila vazia");

  const limit = channelDailyLimitFor(channel.firstConnectedAt ?? channel.createdAt, settings.channelDailyLimit, now);
  if ((await messagesSentToday(db, channel.id, now)) >= limit) return skip("limite diário do número");
  const sentOffers = await offersSentToday(db, now);
  if (!sentOffers.includes(post.offerId) && sentOffers.length >= (await planDailyOffers(channel.tenantId, deps.prisma, now))) {
    return skip("limite de ofertas do plano");
  }

  // Trava otimista: só um processo pega o post.
  const claimed = await db.post.updateMany({
    where: { id: post.id, status: "SCHEDULED" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return skip("post já pego");
  const attempt = post.attempts + 1;
  const interval = deps.fast
    ? randomGroupIntervalMs(FAST_MODE, deps.random)
    : randomGroupIntervalMs(settings, deps.random);

  // Link por grupo (Shopee: subIds [tenant, grupo]); demais lojas usam o link da oferta.
  let link = post.affiliateUrl ?? post.offer.affiliateUrl ?? "";
  let text = post.messageText ?? post.offer.messageText ?? "";
  try {
    if (post.store === "SHOPEE" && post.productExternalId) {
      const groupLink = await (deps.generateLink ?? generateAffiliateLink)(
        channel.tenantId,
        { store: "SHOPEE", externalId: post.productExternalId, productUrl: post.offer.url },
        { groupId: post.groupId },
      );
      if (link) text = text.split(link).join(groupLink);
      link = groupLink;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar o link.";
    if (error instanceof MissingCredentialError || (error instanceof AffiliateLinkError && attempt >= POST_MAX_ATTEMPTS)) {
      // Credencial da loja: pausa só a loja, não o número.
      if (post.store) await pauseStore(db, post.store, `Piloto automático pausado nesta loja: ${message}`, now);
      await db.post.update({ where: { id: post.id }, data: { status: "FAILED", error: message } });
      return { channelId: channel.id, failed: post.id, error: message };
    }
    await retryOrFail(deps, db, channel, post.id, attempt, message, now, interval, { countForChannel: false });
    return { channelId: channel.id, failed: post.id, error: message };
  }

  // Encurtador próprio: o texto leva {base}/o/{código}; o post guarda o link de afiliado (destino do clique).
  if (deps.shortLinkBase && link) text = text.split(link).join(`${deps.shortLinkBase}/o/${post.shortCode}`);

  try {
    const sent = await sendOfferToWhatsApp(
      { db, getSocket: deps.getSocket, ...(deps.loadImage ? { loadImage: deps.loadImage } : {}) },
      post.groupId,
      post.imageUrl ?? post.offer.imageUrl,
      text,
    );
    // Histórico imutável: o que foi enviado de fato fica no próprio post.
    await deps.prisma.$transaction([
      deps.prisma.post.update({
        where: { id: post.id },
        data: {
          status: "SENT",
          sentAt: now,
          externalMessageId: sent.messageId,
          messageText: text,
          affiliateUrl: link,
          error: sent.warning ?? null,
        },
      }),
      deps.prisma.channel.update({
        where: { id: channel.id },
        data: { consecutiveFailures: 0, nextSendAt: new Date(now.getTime() + interval) },
      }),
    ]);
    return { channelId: channel.id, sent: post.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no envio.";
    await retryOrFail(deps, db, channel, post.id, attempt, message, now, interval, { countForChannel: true });
    return { channelId: channel.id, failed: post.id, error: message };
  }
}

/** Nova tentativa com espera crescente; depois da última, FALHOU (e conta para pausar o número). */
async function retryOrFail(
  deps: AutopilotDeps,
  db: TenantDb,
  channel: { id: string },
  postId: string,
  attempt: number,
  message: string,
  now: Date,
  interval: number,
  options: { countForChannel: boolean },
) {
  const nextSendAt = new Date(now.getTime() + interval);
  if (attempt < POST_MAX_ATTEMPTS) {
    const delay = POST_RETRY_DELAYS_MS[attempt - 1] ?? 15 * 60_000;
    await db.post.update({
      where: { id: postId },
      data: { status: "SCHEDULED", scheduledAt: new Date(now.getTime() + delay), error: message },
    });
    await deps.prisma.channel.update({ where: { id: channel.id }, data: { nextSendAt } });
    return;
  }
  await db.post.update({ where: { id: postId }, data: { status: "FAILED", error: message } });
  if (!options.countForChannel) return;
  const updated = await deps.prisma.channel.update({
    where: { id: channel.id },
    data: { consecutiveFailures: { increment: 1 }, nextSendAt },
  });
  if (updated.consecutiveFailures >= CHANNEL_MAX_CONSECUTIVE_FAILURES && !updated.autopilotPausedAt) {
    await deps.prisma.channel.update({
      where: { id: channel.id },
      data: {
        autopilotPausedAt: now,
        autopilotPauseReason: `Envios pausados após ${CHANNEL_MAX_CONSECUTIVE_FAILURES} posts seguidos com falha. Último erro: ${message}`,
      },
    });
    deps.logger?.warn({ channelId: channel.id }, "[piloto] número pausado após falhas seguidas");
  }
}

export async function runDispatch(deps: AutopilotDeps, now: Date): Promise<DispatchResult[]> {
  const channels = await deps.prisma.channel.findMany({
    where: {
      type: "WHATSAPP",
      status: "CONNECTED",
      autopilotPausedAt: null,
      OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
    },
    select: { id: true, tenantId: true, firstConnectedAt: true, createdAt: true },
  });
  const results: DispatchResult[] = [];
  for (const channel of channels) {
    try {
      results.push(await dispatchChannel(deps, channel, now));
    } catch (error) {
      deps.logger?.error({ err: error, channelId: channel.id }, "[fila] falha ao enviar");
    }
  }
  return results;
}

/** Um tick completo. `withPicks`: o piloto escolhe no máximo 1x por minuto. */
export async function runAutopilotTick(deps: AutopilotDeps, now: Date, options: { withPicks?: boolean } = {}) {
  const discarded = await discardExpiredPosts(deps.prisma, now);
  const manual = await queueManualOffers(deps, now);
  const picks = options.withPicks === false ? [] : await runPicks(deps, now);
  const dispatched = await runDispatch(deps, now);
  return { discarded, manual, picks, dispatched };
}
