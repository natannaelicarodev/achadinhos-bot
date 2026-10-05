import { describe, expect, it } from "vitest";
import { parseRequest, type HubItem } from "../src/protocol";
import {
  AMAZON_PAUSE_RANGE_MS,
  checkPageBudget,
  collectVitrine,
  HourlyLimitError,
  isBlockError,
  ML_PAUSE_RANGE_MS,
  postVitrine,
  randomPauseMs,
} from "../src/vitrine";

const item = (id: string): HubItem => ({
  id,
  productUrl: `https://www.mercadolivre.com.br/produto/p/${id}`,
  title: `Produto ${id}`,
  imageUrl: null,
  priceCents: 1000,
  originalPriceCents: null,
  discountLabel: null,
  commissionPct: 5,
  extraCommission: false,
  rating: 4.8,
  soldText: null,
  soldCount: 100,
  highlight: null,
});
const noPause = async () => undefined;

describe("vitrine compartilhada", () => {
  it("aceita ativar com as categorias do painel (MLB + números) e recusa chave curta", () => {
    const token = "a".repeat(43);
    expect(parseRequest("vitrine.configure", { enabled: true, token, categories: ["MLB1246", "MLB264586"] }).ok).toBe(true);
    expect(parseRequest("vitrine.configure", { enabled: true, token, categories: ["MLBd"] }).ok).toBe(false);
    expect(parseRequest("vitrine.configure", { enabled: true, token: "curta", categories: [] }).ok).toBe(false);
  });

  it("busca cada categoria em páginas (offset soma os itens) e a vitrine geral por último", async () => {
    const calls: { category: string | null; offset: number }[] = [];
    const batches = await collectVitrine(
      async (params) => {
        calls.push(params);
        return params.offset >= 4 ? [] : [item(`${params.category}-${params.offset}a`), item(`${params.category}-${params.offset}b`)];
      },
      ["MLB1246", "MLB1071"],
      { pages: 3, minPerCategory: 0, sleep: noPause },
    );
    expect(calls.filter((c) => c.category === "MLB1246").map((c) => c.offset)).toEqual([0, 2, 4]);
    expect(batches.map((b) => b.mlCategory)).toEqual(["MLB1246", "MLB1071", null]);
    expect(batches[0]!.items).toHaveLength(4);
  });

  it("categoria com poucos mais vendidos é completada com a vitrine normal (sem repetir)", async () => {
    const calls: boolean[] = [];
    const batches = await collectVitrine(
      async ({ category, offset, bestSeller }) => {
        if (category !== "MLB1403") return [];
        calls.push(bestSeller);
        if (offset > 0) return [];
        return bestSeller ? [item("MLB1")] : [item("MLB1"), item("MLB2"), item("MLB3")];
      },
      ["MLB1403"],
      { pages: 3, minPerCategory: 60, sleep: noPause },
    );
    expect(calls).toEqual([true, true, false, false]);
    expect(batches[0]!.items.map((i) => i.id)).toEqual(["MLB1", "MLB2", "MLB3"]);
  });

  it("palavras-chave vêm depois das categorias e antes da vitrine geral, com menos páginas", async () => {
    const calls: string[] = [];
    const batches = await collectVitrine(
      async ({ category, search, offset }) => {
        calls.push(`${category ?? "-"}:${search}:${offset}`);
        return offset >= 2 ? [] : [item(`${category}-${search}-${offset}`)];
      },
      ["MLB1246"],
      { searches: ["chocolate"], pages: 5, searchPages: 1, minPerCategory: 0, sleep: noPause },
    );
    expect(batches.map((b) => [b.mlCategory, b.search])).toEqual([["MLB1246", ""], [null, "chocolate"], [null, ""]]);
    expect(calls.filter((c) => c.includes("chocolate"))).toEqual(["-:chocolate:0"]);
  });

  it("falha numa categoria não derruba as outras; se todas falham, avisa o erro", async () => {
    const partial = await collectVitrine(
      async ({ category }) => {
        if (category === "MLB1246") throw new Error("O Mercado Livre recusou");
        return [item(String(category))];
      },
      ["MLB1246", "MLB1071"],
      { pages: 1, minPerCategory: 0, sleep: noPause },
    );
    expect(partial.map((b) => b.mlCategory)).toEqual(["MLB1071", null]);

    await expect(
      collectVitrine(async () => Promise.reject(new Error("Entre na sua conta do Mercado Livre")), ["MLB1246"], { sleep: noPause }),
    ).rejects.toThrow("Entre na sua conta");
  });

  it("envia ao painel com a chave no Authorization e mostra o erro do painel", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ upserted: 7 }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(postVitrine(ok, "http://localhost:3000", "k".repeat(40), [])).resolves.toEqual({ upserted: 7 });
    expect(seen).toEqual({ url: "http://localhost:3000/api/catalog/mercado-livre", auth: `Bearer ${"k".repeat(40)}` });

    const refused = (async () => new Response(JSON.stringify({ error: "Chave da vitrine inválida." }), { status: 401 })) as unknown as typeof fetch;
    await expect(postVitrine(refused, "http://localhost:3000", "k".repeat(40), [])).rejects.toThrow("Chave da vitrine inválida.");
  });
});

describe("vitrine: cuidados contra bloqueio", () => {
  it("pausa aleatória dentro da faixa (ML 3-6 s, Amazon 5-10 s)", () => {
    expect(randomPauseMs(ML_PAUSE_RANGE_MS, () => 0)).toBe(3_000);
    expect(randomPauseMs(ML_PAUSE_RANGE_MS, () => 0.999)).toBeLessThanOrEqual(6_000);
    expect(randomPauseMs(AMAZON_PAUSE_RANGE_MS, () => 0.5)).toBe(7_500);
  });

  it("usa pausas aleatórias entre os pedidos (não fixas)", async () => {
    const waits: number[] = [];
    let r = 0;
    await collectVitrine(async ({ offset }) => (offset > 0 ? [] : [item(`x${offset}`)]), ["MLB1"], {
      pages: 1,
      minPerCategory: 0,
      random: () => (r++ % 2 === 0 ? 0 : 1),
      sleep: async (ms) => void waits.push(ms),
    });
    expect(waits).toEqual([3_000]); // 1 pausa (antes do 2º pedido), sorteada na faixa
    expect(waits.every((w) => w >= 3_000 && w <= 6_000)).toBe(true);
  });

  it("janela móvel de 60 min: conta só as páginas da última hora", () => {
    const now = 10 * 60 * 60_000;
    const log = [now - 61 * 60_000, now - 30 * 60_000, now - 1_000];
    expect(checkPageBudget(log, now, 2)).toEqual({ ok: false, log: [now - 30 * 60_000, now - 1_000] });
    expect(checkPageBudget(log, now, 3).ok).toBe(true);
  });

  it("limite da hora: para e devolve o que já leu; bloqueio: lança na hora", async () => {
    let pages = 0;
    const budget = async () => {
      if (++pages > 2) throw new HourlyLimitError("limite de 2 páginas por hora atingido");
    };
    const partial = await collectVitrine(async ({ offset }) => [item(`p${offset}-${pages}`)], ["MLB1", "MLB2"], {
      pages: 3,
      minPerCategory: 0,
      beforeRequest: budget,
      sleep: noPause,
    });
    expect(partial.map((b) => [b.mlCategory, b.items.length])).toEqual([["MLB1", 2]]);

    const blockedError = Object.assign(new Error("Muitos pedidos"), { status: 429 });
    expect(isBlockError(blockedError)).toBe(true);
    expect(isBlockError(new Error("A Amazon pediu uma verificação (captcha)."))).toBe(true);
    expect(isBlockError(new Error("Entre na sua conta do Mercado Livre"))).toBe(false);
    await expect(
      collectVitrine(async () => Promise.reject(blockedError), ["MLB1", "MLB2"], { sleep: noPause }),
    ).rejects.toThrow("Muitos pedidos");
  });
});
