// Página Agendamento: dados do piloto automático e da fila (servidor).
import {
  autopilotStores,
  channelDailyLimitFor,
  DEFAULT_AUTOPILOT,
  forTenant,
  getCurrentSubscription,
  maxOffersPerHour,
  maxPriceAgeHours,
  startOfLocalDay,
  warmupDay,
  type PostStatus,
  type Store,
} from "@achadinhos/db";
import { getPrisma } from "@achadinhos/db";

export const POST_STATUS_LABEL: Record<PostStatus, { label: string; tone: "muted" | "ok" | "warn" | "error" }> = {
  SCHEDULED: { label: "Agendado", tone: "muted" },
  QUEUED: { label: "Agendado", tone: "muted" },
  SENDING: { label: "Enviando", tone: "muted" },
  AWAITING_LINK: { label: "Aguardando link", tone: "muted" },
  SENT: { label: "Enviado", tone: "ok" },
  FAILED: { label: "Falhou", tone: "error" },
  DISCARDED: { label: "Descartado", tone: "warn" },
  CANCELED: { label: "Cancelado", tone: "warn" },
};

/** Lojas da vitrine (Mercado Livre e Amazon) dependem do Chrome do administrador; Shopee do worker. */
const FRESHNESS_STORES: Store[] = ["SHOPEE", "AMAZON", "MERCADO_LIVRE"];

export async function loadAutopilotOverview(tenantId: string, now: Date = new Date()) {
  const db = forTenant(tenantId);
  const dayStart = startOfLocalDay(now);
  const [settingsRow, subscription, channels, groups, credentials, sentToday, queue] = await Promise.all([
    db.autopilotSettings.findUnique({ where: { tenantId } }),
    getCurrentSubscription(tenantId),
    db.channel.findMany({ where: { type: "WHATSAPP" }, orderBy: { createdAt: "asc" } }),
    db.group.findMany({
      where: { active: true, channel: { type: "WHATSAPP" } },
      select: { id: true, name: true, channelId: true, postingEnabled: true, canSend: true },
      orderBy: { name: "asc" },
    }),
    db.storeCredential.findMany({ select: { store: true, autopilotPausedAt: true, lastError: true } }),
    db.post.findMany({
      where: { status: "SENT", sentAt: { gte: dayStart } },
      select: { offerId: true, group: { select: { channelId: true } } },
    }),
    db.post.findMany({
      where: { OR: [{ createdAt: { gte: dayStart } }, { status: { in: ["SCHEDULED", "SENDING", "AWAITING_LINK"] } }] },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: { group: { select: { name: true } }, offer: { select: { title: true } } },
    }),
  ]);
  const settings = settingsRow ?? { ...DEFAULT_AUTOPILOT, tenantId };

  // Frescor do catálogo por loja: última mineração com sucesso.
  const runs = await Promise.all(
    FRESHNESS_STORES.map((store) =>
      getPrisma().catalogMiningRun.findFirst({
        where: { store, status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
        select: { store: true, finishedAt: true, startedAt: true },
      }),
    ),
  );
  const maxAgeHours = maxPriceAgeHours();
  const freshness = FRESHNESS_STORES.map((store, i) => {
    const run = runs[i];
    const at = run ? (run.finishedAt ?? run.startedAt) : null;
    return { store, at, stale: !at || now.getTime() - at.getTime() > maxAgeHours * 3_600_000 };
  });

  // Grupos que recebem hoje e o máximo de ofertas por hora que cabe.
  const targets = settings.groupIds.length > 0
    ? groups.filter((g) => settings.groupIds.includes(g.id) && g.canSend)
    : groups.filter((g) => g.postingEnabled && g.canSend);
  const perChannel = new Map<string, number>();
  for (const g of targets) perChannel.set(g.channelId, (perChannel.get(g.channelId) ?? 0) + 1);
  const maxGroupsPerChannel = Math.max(0, ...perChannel.values());

  const offersToday = new Set(sentToday.map((p) => p.offerId)).size;
  const channelStats = channels.map((c) => {
    const since = c.firstConnectedAt ?? c.createdAt;
    return {
      id: c.id,
      name: c.name,
      externalId: c.externalId,
      status: c.status,
      paused: c.autopilotPausedAt !== null,
      pauseReason: c.autopilotPauseReason,
      messagesToday: sentToday.filter((p) => p.group.channelId === c.id).length,
      dailyLimit: channelDailyLimitFor(since, settings.channelDailyLimit, now),
      warmupDay: warmupDay(since, now),
      groups: perChannel.get(c.id) ?? 0,
    };
  });

  return {
    settings,
    plan: { name: subscription?.plan.name ?? "Sem plano", maxOffersPerDay: subscription?.plan.maxPostsPerDay ?? 0 },
    offersToday,
    channels: channelStats,
    groups,
    targetCount: targets.length,
    maxGroupsPerChannel,
    maxOffersPerHour: maxOffersPerHour(maxGroupsPerChannel, settings.groupIntervalMaxSeconds),
    allowedStores: autopilotStores(),
    credentials,
    freshness,
    maxAgeHours,
    queue,
    devFast: process.env.AUTOPILOT_DEV_FAST === "true" && process.env.NODE_ENV !== "production",
  };
}

export type AutopilotOverview = Awaited<ReturnType<typeof loadAutopilotOverview>>;
