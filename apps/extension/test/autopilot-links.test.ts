import { describe, expect, it } from "vitest";
import { syncAutopilotLinks } from "../src/autopilot-links";

const PANEL = "http://localhost:3000";
const TOKEN = "t".repeat(43);

function fakePanel(pending: { offerId: string; productUrl: string; tag: string; store: "MERCADO_LIVRE" | "AMAZON" }[]) {
  const calls: { auth: string | null; links: { offerId: string; shortUrl: string }[] }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    expect(url).toBe(`${PANEL}/api/extension/autopilot`);
    const body = JSON.parse(String(init.body)) as { links: { offerId: string; shortUrl: string }[] };
    calls.push({ auth: new Headers(init.headers).get("authorization"), links: body.links });
    const first = calls.length === 1;
    return new Response(JSON.stringify({ applied: first ? 0 : body.links.length * 2, rejected: 0, pending: first ? pending : [] }));
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe("piloto automático do cliente: meli.la pela extensão", () => {
  it("pega os pendentes, gera o meli.la com a etiqueta do cliente e entrega ao painel", async () => {
    const { http, calls } = fakePanel([
      { offerId: "o1", productUrl: "https://www.mercadolivre.com.br/p/MLB1", tag: "minhaloja", store: "MERCADO_LIVRE" as const },
      { offerId: "o2", productUrl: "https://www.mercadolivre.com.br/p/MLB2", tag: "minhaloja", store: "MERCADO_LIVRE" as const },
    ]);
    const created: string[] = [];
    const result = await syncAutopilotLinks(http, PANEL, TOKEN, async ({ productUrl, tag }) => {
      created.push(`${productUrl}|${tag}`);
      return `https://meli.la/${productUrl.slice(-4)}`;
    });
    expect(created).toEqual(["https://www.mercadolivre.com.br/p/MLB1|minhaloja", "https://www.mercadolivre.com.br/p/MLB2|minhaloja"]);
    expect(calls.map((c) => c.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(calls[1]!.links).toEqual([
      { offerId: "o1", shortUrl: "https://meli.la/MLB1" },
      { offerId: "o2", shortUrl: "https://meli.la/MLB2" },
    ]);
    expect(result).toEqual({ generated: 2, applied: 4, failed: 0 });
  });

  it("sem pendentes: só o sinal de vida; falha num produto não derruba os outros", async () => {
    const empty = fakePanel([]);
    expect(await syncAutopilotLinks(empty.http, PANEL, TOKEN, async () => "x")).toEqual({ generated: 0, applied: 0, failed: 0 });
    expect(empty.calls).toHaveLength(1);

    const some = fakePanel([
      { offerId: "o1", productUrl: "https://www.mercadolivre.com.br/p/MLB1", tag: "t", store: "MERCADO_LIVRE" as const },
      { offerId: "o2", productUrl: "https://www.mercadolivre.com.br/p/MLB2", tag: "t", store: "MERCADO_LIVRE" as const },
    ]);
    const result = await syncAutopilotLinks(some.http, PANEL, TOKEN, async ({ productUrl: url }) => {
      if (url.endsWith("MLB1")) throw new Error("Entre na sua conta do Mercado Livre");
      return "https://meli.la/ok";
    });
    expect(result).toEqual({ generated: 1, applied: 2, failed: 1 });
  });

  it("chave recusada pelo painel vira erro em pt-BR", async () => {
    const http = (async () => new Response(JSON.stringify({ error: "Chave da extensão inválida." }), { status: 401 })) as unknown as typeof fetch;
    await expect(syncAutopilotLinks(http, PANEL, TOKEN, async () => "x")).rejects.toThrow("Chave da extensão inválida.");
  });
});
