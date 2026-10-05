// Piloto automático do CLIENTE + links curtos: de minuto em minuto a extensão pergunta ao
// painel quais produtos precisam de link curto (ML: meli.la; Amazon: link.amazon), gera com a
// conta do cliente (mesmos pedidos do modo manual) e devolve. O painel confere antes de usar.
export const AUTOPILOT_ENDPOINT_PATH = "/api/extension/autopilot";
export const AUTOPILOT_LINKS_EVERY_MINUTES = 1;

export interface PendingLink {
  offerId: string;
  store: "MERCADO_LIVRE" | "AMAZON";
  productUrl: string;
  tag: string;
}

interface CallResult {
  applied: number;
  rejected: number;
  pending: PendingLink[];
}

async function call(http: typeof fetch, endpoint: string, token: string, links: { offerId: string; shortUrl: string }[]): Promise<CallResult> {
  const response = await http(new URL(AUTOPILOT_ENDPOINT_PATH, endpoint).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ links }),
  });
  let body: Partial<CallResult> & { error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // resposta sem JSON
  }
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `O painel recusou (HTTP ${response.status}).`);
  }
  return { applied: body.applied ?? 0, rejected: body.rejected ?? 0, pending: Array.isArray(body.pending) ? body.pending : [] };
}

/**
 * Uma rodada: sinal de vida + produtos pendentes; gera os meli.la; entrega.
 * Falha num produto não derruba os outros (ele volta na próxima rodada).
 */
export async function syncAutopilotLinks(
  http: typeof fetch,
  endpoint: string,
  token: string,
  createLink: (item: PendingLink) => Promise<string>,
): Promise<{ generated: number; applied: number; failed: number }> {
  const first = await call(http, endpoint, token, []);
  if (first.pending.length === 0) return { generated: 0, applied: 0, failed: 0 };
  const links: { offerId: string; shortUrl: string }[] = [];
  let failed = 0;
  for (const item of first.pending) {
    try {
      links.push({ offerId: item.offerId, shortUrl: await createLink(item) });
    } catch {
      failed += 1;
    }
  }
  if (links.length === 0) return { generated: 0, applied: 0, failed };
  const second = await call(http, endpoint, token, links);
  return { generated: links.length, applied: second.applied, failed: failed + second.rejected };
}
