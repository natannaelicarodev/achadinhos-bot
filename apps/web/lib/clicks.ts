// Encurtador próprio (/o/[codigo]): registro de cliques. LGPD: o IP nunca é guardado,
// só uma impressão (HMAC-SHA256 com chave secreta) para reconhecer clique repetido.
import { createHash, createHmac } from "node:crypto";
import type { PrismaClient } from "@achadinhos/db";

/** Mesmo IP no mesmo post conta 1 clique a cada 30 min. */
export const CLICK_DEDUP_MS = 30 * 60_000;

/**
 * Robôs de pré-visualização de link (WhatsApp, Telegram, redes sociais), buscadores e
 * ferramentas automáticas: o redirecionamento acontece (a prévia mostra o produto), mas
 * o clique não conta.
 */
const BOT_UA =
  /whatsapp|telegrambot|facebookexternalhit|facebot|meta-externalagent|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|google-inspectiontool|bingbot|yandex|baiduspider|duckduckbot|applebot|pinterest|embedly|bot\b|bot\/|crawler|spider|preview|curl|wget|python|httpclient|okhttp|go-http-client|axios|node-fetch|headlesschrome|phantomjs|lighthouse/i;

export function isBotRequest(request: { method: string; headers: Headers }): boolean {
  if (request.method !== "GET") return true; // HEAD e afins: robô/checagem
  const ua = request.headers.get("user-agent")?.trim() ?? "";
  if (!ua) return true;
  // Pré-carregamento do navegador (não é clique de pessoa).
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return true;
  return BOT_UA.test(ua);
}

/** IP do visitante (primeiro do x-forwarded-for, que o Railway preenche). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** Chave da impressão do IP: CLICK_HASH_SECRET (ou derivada da chave das credenciais). */
export function clickHashSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.CLICK_HASH_SECRET?.trim();
  if (secret) return secret;
  return createHash("sha256").update(`click-ip:${env.STORE_CREDENTIALS_KEY ?? "dev"}`).digest("hex");
}

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export interface ClickPost {
  id: string;
  tenantId: string;
  offerId: string;
  groupId: string;
}

export type ClickResult = "counted" | "bot" | "repeat";

/** Registra o clique (se for de pessoa e não for repetição). Nunca guarda o IP. */
export async function recordClick(
  prisma: PrismaClient,
  post: ClickPost,
  request: { method: string; headers: Headers },
  options: { now?: Date; secret?: string } = {},
): Promise<ClickResult> {
  if (isBotRequest(request)) return "bot";
  const now = options.now ?? new Date();
  const ip = clientIp(request.headers);
  const ipHash = ip ? hashIp(ip, options.secret ?? clickHashSecret()) : null;
  if (ipHash) {
    const recent = await prisma.click.findFirst({
      where: { postId: post.id, ipHash, createdAt: { gte: new Date(now.getTime() - CLICK_DEDUP_MS) } },
      select: { id: true },
    });
    if (recent) return "repeat";
  }
  await prisma.click.create({
    data: {
      tenantId: post.tenantId,
      offerId: post.offerId,
      postId: post.id,
      groupId: post.groupId,
      ipHash,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      referer: request.headers.get("referer")?.slice(0, 300) ?? null,
      createdAt: now,
    },
  });
  return "counted";
}

/** Destino do redirecionamento: só https (link de afiliado gravado no post). */
export function safeRedirectTarget(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
