import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import type { MinedProduct } from "@achadinhos/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AMAZON_DISABLED_REASONS, AMAZON_TOKEN_URL, AmazonCreatorsClient, AmazonMiner } from "../src/catalog/amazon";
import { runCatalogMining } from "../src/catalog/run";
import { SHOPEE_CATEGORY_KEYWORDS, ShopeeMiner } from "../src/catalog/shopee";
import type { CatalogMiner } from "../src/catalog/types";
import { closeInterruptedRuns, miningIsDue, processCatalogJob } from "../src/queues/catalog";
import { silentLogger } from "./helpers";

// Item no formato da Shopee (números como texto, como a API devolve).
function shopeeNode(itemId: number, extra: Record<string, unknown> = {}) {
  return {
    itemId,
    productName: `Fone Bluetooth ${itemId}`,
    imageUrl: `https://cf.shopee.com.br/file/${itemId}`,
    priceMin: "59.90",
    priceMax: "79.90",
    priceDiscountRate: 40,
    commissionRate: "0.08",
    commission: "4.79",
    sales: 12500,
    ratingStar: "4.8",
    productLink: `https://shopee.com.br/product/111/${itemId}`,
    offerLink: `https://s.shopee.com.br/CENTRAL${itemId}`,
    productCatIds: [100, 200],
    ...extra,
  };
}

const graphqlOk = (nodes: unknown[]) =>
  new Response(JSON.stringify({ data: { productOfferV2: { nodes, pageInfo: { page: 1, limit: 50, hasNextPage: false } } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });


describe("Shopee: minerador", () => {
  it("desligado sem credencial central", () => {
    expect(new ShopeeMiner({}).status()).toEqual({
      enabled: false,
      reason: "Credencial central da Shopee não configurada (SHOPEE_CATALOG_APP_ID e SHOPEE_CATALOG_SECRET).",
    });
  });

  it("busca mais vendidos e maior comissão por categoria + top performing", async () => {
    const queries: string[] = [];
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      queries.push(query);
      return graphqlOk([shopeeNode(queries.length)]);
    }) as typeof fetch;
    const miner = new ShopeeMiner({ appId: "1", secret: "s", fetch: fetchMock, sleep: async () => {}, topPerformingPages: 1 });

    const result = await miner.mine();
    const keywordCount = Object.values(SHOPEE_CATEGORY_KEYWORDS).flat().length;
    expect(result.requests).toBe(keywordCount * 2 + 1);
    expect(result.failures).toBe(0);
    expect(queries.filter((q) => q.includes("sortType: 2") && q.includes("keyword")).length).toBe(keywordCount);
    expect(queries.filter((q) => q.includes("sortType: 5")).length).toBe(keywordCount);
    expect(queries.some((q) => q.includes("listType: 2"))).toBe(true);
    // A categoria vem da palavra-chave que achou o produto.
    expect(result.products[0]?.category).toBe("FOOD_BEVERAGES");
    expect(result.products.at(-1)?.category).toBe("OTHER");
  });

  it("falha parcial segue; falha total derruba a execução com o motivo", async () => {
    let call = 0;
    const flaky = (async () => (++call % 2 === 0 ? new Response("x", { status: 500 }) : graphqlOk([shopeeNode(call)]))) as typeof fetch;
    const partial = await new ShopeeMiner({ appId: "1", secret: "s", fetch: flaky, sleep: async () => {} }).mine();
    expect(partial.failures).toBeGreaterThan(0);
    expect(partial.products.length).toBeGreaterThan(0);

    const down = (async () => new Response("x", { status: 401 })) as unknown as typeof fetch;
    await expect(new ShopeeMiner({ appId: "1", secret: "s", fetch: down, sleep: async () => {} }).mine()).rejects.toThrow(
      "Shopee respondeu HTTP 401.",
    );
  });

  it("verify: produto devolvido = ainda existe; lista vazia = sumiu; erro de rede = não decide", async () => {
    const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes("itemId: 1,")) return graphqlOk([shopeeNode(1)]);
      if (query.includes("itemId: 2,")) return graphqlOk([]);
      return new Response("x", { status: 503 });
    }) as typeof fetch;
    const result = await new ShopeeMiner({ appId: "1", secret: "s", fetch: fetchMock, sleep: async () => {} }).verify([
      "1",
      "2",
      "3",
    ]);
    expect(result.get("1")?.externalId).toBe("1");
    expect(result.get("2")).toBeNull();
    expect(result.has("3")).toBe(false);
  });
});

describe("Amazon", () => {
  it("sem credencial: desligado com motivo", () => {
    expect(new AmazonMiner({}).status()).toEqual({ enabled: false, reason: AMAZON_DISABLED_REASONS.missingCredentials });
  });

  it("com credencial: continua desligado até o SearchItems ser confirmado", () => {
    const miner = new AmazonMiner({ credentialId: "id", credentialSecret: "s", partnerTag: "central-20" });
    expect(miner.status()).toEqual({ enabled: false, reason: AMAZON_DISABLED_REASONS.searchNotConfirmed });
  });

  it("token OAuth (client_credentials) com cache até perto de expirar", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: `tok-${fetchMock.mock.calls.length}`, expires_in: 3600 })),
    );
    const client = new AmazonCreatorsClient(
      { credentialId: "id", credentialSecret: "s", partnerTag: "t" },
      fetchMock as unknown as typeof fetch,
      () => clock,
    );
    expect(await client.accessToken()).toBe("tok-1");
    expect(await client.accessToken()).toBe("tok-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(AMAZON_TOKEN_URL);
    expect(JSON.parse(String(init.body))).toMatchObject({ grant_type: "client_credentials", scope: "creatorsapi::default" });

    clock = 3600 * 1000 - 30_000; // falta menos de 1 min
    expect(await client.accessToken()).toBe("tok-2");
  });
});

describe("execução da mineração", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });

  const product = (externalId: string, extra: Partial<MinedProduct> = {}): MinedProduct => ({
    store: "SHOPEE",
    externalId,
    title: `P ${externalId}`,
    imageUrl: null,
    productUrl: `https://shopee.com.br/product/1/${externalId}`,
    category: "PETS",
    priceCents: 1000,
    originalPriceCents: null,
    discountPct: null,
    commissionPct: 5,
    commissionCents: 50,
    rating: 4.9,
    soldCount: 100,
    ...extra,
  });

  function fakeMiner(over: Partial<CatalogMiner>): CatalogMiner {
    return {
      store: "SHOPEE",
      status: () => ({ enabled: true }),
      mine: async () => ({ products: [], requests: 1, failures: 0 }),
      verify: async () => new Map(),
      ...over,
    };
  }

  it("minerador desligado vira registro SKIPPED com o motivo (e aparece no log)", async () => {
    const [run] = await runCatalogMining({ prisma: db.prisma, logger: silentLogger, miners: [new AmazonMiner({})] });
    expect(run).toMatchObject({ store: "AMAZON", status: "SKIPPED", message: AMAZON_DISABLED_REASONS.missingCredentials });
  });

  it("grava, conta, reconfere os parados e desativa o que sumiu", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-03T00:00:00Z");
    // Dois produtos antigos (parados há 2 dias).
    await runCatalogMining({
      prisma: db.prisma,
      logger: silentLogger,
      now: () => old,
      miners: [fakeMiner({ mine: async () => ({ products: [product("fica"), product("some")], requests: 1, failures: 0 }) })],
    });

    const [run] = await runCatalogMining({
      prisma: db.prisma,
      logger: silentLogger,
      now: () => now,
      miners: [
        fakeMiner({
          mine: async () => ({ products: [product("novo"), product("ruim", { rating: 4.1 })], requests: 2, failures: 1 }),
          verify: async (ids) => new Map(ids.map((id) => [id, id === "fica" ? product("fica", { category: "OTHER" }) : null])),
        }),
      ],
    });

    expect(run).toMatchObject({ status: "SUCCESS", fetched: 2, upserted: 2, deactivated: 1 });
    expect(run?.message).toBe("1 de 2 buscas falharam; as demais foram gravadas.");
    const rows = await db.prisma.catalogProduct.findMany({ where: { store: "SHOPEE" }, orderBy: { externalId: "asc" } });
    expect(rows.map((r) => [r.externalId, r.active, r.category])).toEqual([
      ["fica", true, "PETS"],
      ["novo", true, "PETS"],
      ["some", false, "PETS"],
    ]);
  });

  it("erro na mineração vira registro FAILED com a mensagem", async () => {
    const [run] = await runCatalogMining({
      prisma: db.prisma,
      logger: silentLogger,
      miners: [fakeMiner({ mine: async () => Promise.reject(new Error("Invalid Signature")) })],
    });
    expect(run).toMatchObject({ status: "FAILED", message: "Invalid Signature" });
  });

  it("ao subir, só minera de novo se a última execução já venceu o intervalo", async () => {
    const last = await db.prisma.catalogMiningRun.findFirstOrThrow({
      where: { status: { not: "SKIPPED" } },
      orderBy: { startedAt: "desc" },
    });
    expect(await miningIsDue(db.prisma, 60, new Date(last.startedAt.getTime() + 10 * 60_000))).toBe(false);
    expect(await miningIsDue(db.prisma, 60, new Date(last.startedAt.getTime() + 61 * 60_000))).toBe(true);
  });

  it("execução pulada (sem credencial) não conta: configurou a credencial, minera na hora", async () => {
    const fresh = await createTestDatabase({ seedPlans: false });
    try {
      await runCatalogMining({ prisma: fresh.prisma, logger: silentLogger, miners: [new AmazonMiner({})] });
      expect(await fresh.prisma.catalogMiningRun.count({ where: { status: "SKIPPED" } })).toBe(1);
      expect(await miningIsDue(fresh.prisma, 60)).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it("ao subir, execução que ficou RUNNING (worker reiniciou) vira FAILED com motivo", async () => {
    const fresh = await createTestDatabase({ seedPlans: false });
    try {
      await fresh.prisma.catalogMiningRun.create({ data: { store: "SHOPEE", status: "RUNNING" } });
      expect(await closeInterruptedRuns(fresh.prisma)).toBe(1);
      const run = await fresh.prisma.catalogMiningRun.findFirstOrThrow();
      expect(run).toMatchObject({ status: "FAILED", message: "Execução interrompida (o worker reiniciou no meio)." });
    } finally {
      await fresh.close();
    }
  });

  it("job do agendador não minera duas vezes seguidas", async () => {
    const fresh = await createTestDatabase({ seedPlans: false });
    try {
      const mine = vi.fn(async () => ({ products: [], requests: 1, failures: 0 }));
      const deps = { prisma: fresh.prisma, logger: silentLogger, intervalMinutes: 60, miners: [fakeMiner({ mine })] };
      expect(await processCatalogJob(deps)).toBe("ran");
      expect(await processCatalogJob(deps)).toBe("not-due");
      expect(mine).toHaveBeenCalledTimes(1);
    } finally {
      await fresh.close();
    }
  });
});
