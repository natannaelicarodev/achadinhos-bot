import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveMinedProducts } from "../src/catalog";
import { saveOfferForSending, type OfferForSending } from "../src/offers";
import { listStoreCredentials, saveStoreCredential, setStoreCredentialStatus } from "../src/store-credentials";
import { createTestDatabase, type TestDatabase } from "../src/testing";

let db: TestDatabase;
const key = randomBytes(32);

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

const newTenant = (slug: string) => db.prisma.tenant.create({ data: { name: slug, slug } });

describe("status da credencial (Sincronizado)", () => {
  it("salvar sem verificação = não sincronizado; Testar ok = sincronizado; falha guarda o motivo", async () => {
    const t = await newTenant("cred-status");
    const opts = { client: db.prisma, key };
    await saveStoreCredential(t.id, { store: "SHOPEE", secrets: { appId: "12345678901", apiSecret: "segredo123" } }, opts);
    let [row] = await listStoreCredentials(t.id, opts);
    expect(row).toMatchObject({ verifiedAt: null, lastError: null });
    expect(JSON.stringify(row)).not.toContain("segredo123");

    await setStoreCredentialStatus(t.id, "SHOPEE", { ok: false, error: "AppID ou Senha recusados." }, opts);
    [row] = await listStoreCredentials(t.id, opts);
    expect(row).toMatchObject({ verifiedAt: null, lastError: "AppID ou Senha recusados." });

    await setStoreCredentialStatus(t.id, "SHOPEE", { ok: true }, opts);
    [row] = await listStoreCredentials(t.id, opts);
    expect(row?.verifiedAt).toBeInstanceOf(Date);
    expect(row?.lastError).toBeNull();

    // Trocar os dados exige testar de novo.
    await saveStoreCredential(t.id, { store: "SHOPEE", secrets: { appId: "12345678902", apiSecret: "outro1234" } }, opts);
    [row] = await listStoreCredentials(t.id, opts);
    expect(row?.verifiedAt).toBeNull();
  });

  it("lojas sem API (ex.: Amazon) podem salvar já sincronizadas", async () => {
    const t = await newTenant("cred-amazon");
    const opts = { client: db.prisma, key };
    await saveStoreCredential(t.id, { store: "AMAZON", secrets: { tag: "loja-20" }, verifiedAt: new Date() }, opts);
    const [row] = await listStoreCredentials(t.id, opts);
    expect(row?.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("Enviar para meus grupos (oferta pronta)", () => {
  const offer = (extra: Partial<OfferForSending> = {}): OfferForSending => ({
    store: "MERCADO_LIVRE",
    externalId: "MLB123456",
    title: "Air Fryer",
    url: "https://produto.mercadolivre.com.br/MLB-123456-air-fryer",
    affiliateUrl: "https://produto.mercadolivre.com.br/MLB-123456-air-fryer?matt_word=loja&matt_tool=999",
    imageUrl: null,
    priceCents: 29990,
    originalPriceCents: 39990,
    messageText: "*OFERTA*\nAir Fryer",
    ...extra,
  });

  it("link colado: cria a oferta ativa com link, mensagem e pedido de envio; repetir atualiza a mesma", async () => {
    const t = await newTenant("envio-link");
    const now = new Date("2026-10-08T10:00:00Z");
    const first = await saveOfferForSending(t.id, offer(), { client: db.prisma, now });
    expect(first).toMatchObject({ status: "ACTIVE", messageText: "*OFERTA*\nAir Fryer", catalogProductId: null });
    expect(first.sendRequestedAt).toEqual(now);

    const again = await saveOfferForSending(t.id, offer({ priceCents: 25990, messageText: "nova" }), { client: db.prisma });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ priceCents: 25990, messageText: "nova" });
  });

  it("produto do catálogo: uma oferta por produto (reaproveita a do Divulgar)", async () => {
    const t = await newTenant("envio-catalogo");
    await saveMinedProducts(db.prisma, [
      {
        store: "SHOPEE",
        externalId: "777",
        title: "Fone",
        imageUrl: null,
        productUrl: "https://shopee.com.br/product/1/777",
        category: "ELECTRONICS",
        priceCents: 5000,
        originalPriceCents: null,
        discountPct: null,
        commissionPct: 8,
        commissionCents: 400,
        rating: 4.9,
        soldCount: 10,
      },
    ]);
    const product = await db.prisma.catalogProduct.findFirstOrThrow({ where: { externalId: "777" } });
    const input = offer({ store: "SHOPEE", externalId: "777", catalogProductId: product.id, affiliateUrl: "https://s.shopee.com.br/abc" });
    const a = await saveOfferForSending(t.id, input, { client: db.prisma });
    const b = await saveOfferForSending(t.id, { ...input, messageText: "editada" }, { client: db.prisma });
    expect(b.id).toBe(a.id);
    expect(await db.prisma.offer.count({ where: { tenantId: t.id } })).toBe(1);
  });
});
