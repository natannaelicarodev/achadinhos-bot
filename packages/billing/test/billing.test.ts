import { forTenant, getCurrentSubscription, getSendingBlock, startTrial } from "@achadinhos/db";
import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentFingerprint, documentLast4, parseDocument } from "../src/document";
import {
  cancelSubscription,
  changePlan,
  reconcileTenant,
  refundPayment,
  subscribe,
  syncPayment,
  type BillingDeps,
  type BillingNotice,
} from "../src/flows";
import { upgradeDifferenceCents } from "../src/pricing";
import { handleWebhookEvent, isValidWebhookToken } from "../src/webhook";
import { FakeAsaas } from "./fake-asaas";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.close();
});

const DAY = 86_400_000;
/** Terça, 06/10/2026, 10:00 em São Paulo. */
const T0 = new Date("2026-10-06T13:00:00Z");
const CPF = "529.982.247-25";
const SECRET = "segredo-do-documento-para-testes";
const at = (iso: string) => new Date(iso);

let n = 0;
async function newTenant(verified = true) {
  const slug = `bill-${++n}`;
  const tenant = await db.prisma.tenant.create({ data: { name: slug, slug } });
  await db.prisma.user.create({
    data: { tenantId: tenant.id, email: `${slug}@x.com`, name: "X", passwordHash: "x", role: "OWNER", emailVerifiedAt: verified ? T0 : null },
  });
  await startTrial(db.prisma, tenant.id, T0);
  return tenant.id;
}

function depsOf(fake: FakeAsaas, now: Date, notices: BillingNotice[] = []): BillingDeps {
  return { client: db.prisma, asaas: fake.client, now, documentSecret: SECRET, notify: async (x) => void notices.push(x) };
}

/** Cada teste com um CPF válido diferente (o mesmo CPF em duas contas tira o teste grátis). */
let cpfSeq = 100_000_000;
function nextCpf(): string {
  const dv = (b: string) => {
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += Number(b[i]) * (b.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  for (;;) {
    const base = String(++cpfSeq).padStart(9, "0");
    const d1 = dv(base);
    const cpf = `${base}${d1}${dv(`${base}${d1}`)}`;
    if (parseDocument(cpf)) return cpf;
  }
}

const plan = (tenantId: string, now: Date) => getCurrentSubscription(tenantId, { client: db.prisma, now }).then((s) => s?.plan.code);

/** Assinou (mensal) e pagou a 1ª cobrança no fim do teste (13/10). */
async function paying(fake: FakeAsaas, planCode = "starter") {
  const tenantId = await newTenant();
  await subscribe(depsOf(fake, T0), { tenantId, planCode, cycle: "MONTHLY", name: "Ana Souza", document: nextCpf(), email: "a@x.com" });
  const first = [...fake.payments.values()].at(-1)!;
  await syncPayment(depsOf(fake, at("2026-10-13T15:00:00Z")), fake.pay(first.id, "2026-10-13"));
  return { tenantId, subId: [...fake.subscriptions.keys()].at(-1)! };
}

describe("CPF/CNPJ e proporcional", () => {
  it("valida CPF e CNPJ; guarda só 4 dígitos e a impressão irreversível", () => {
    expect(parseDocument(CPF)).toBe("52998224725");
    expect(parseDocument("11.222.333/0001-81")).toBe("11222333000181");
    expect(parseDocument("111.111.111-11")).toBeNull();
    expect(parseDocument("529.982.247-24")).toBeNull();
    expect(documentLast4("52998224725")).toBe("4725");
    const fp = documentFingerprint("52998224725", SECRET);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain("52998224725");
    expect(documentFingerprint("52998224725", `${SECRET}x`)).not.toBe(fp);
  });

  it("diferença proporcional aos dias restantes", () => {
    const start = at("2026-10-01T03:00:00Z");
    const end = at("2026-10-31T03:00:00Z");
    expect(upgradeDifferenceCents(4700, 9700, start, end, at("2026-10-16T03:00:00Z"))).toBe(2500);
    expect(upgradeDifferenceCents(9700, 4700, start, end, at("2026-10-16T03:00:00Z"))).toBe(0);
  });
});

describe("assinar", () => {
  it("cria cliente e assinatura; 1ª cobrança no fim do teste; plano escolhido só com pagamento", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    const cpf = nextCpf();
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "pro", cycle: "MONTHLY", name: "Ana Souza", document: cpf, email: "a@x.com" });
    const [sub] = [...fake.subscriptions.values()];
    expect(sub).toMatchObject({ value: 97, nextDueDate: "2026-10-13" });
    const tenant = await db.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.billingDocumentLast4).toBe(cpf.slice(-4));
    expect(JSON.stringify(tenant)).not.toContain(cpf);
    expect(await plan(tenantId, T0)).toBe("starter");

    const first = [...fake.payments.values()][0]!;
    await syncPayment(depsOf(fake, at("2026-10-13T15:00:00Z")), fake.pay(first.id, "2026-10-13"));
    expect(await plan(tenantId, at("2026-10-13T16:00:00Z"))).toBe("pro");
    const logs = await forTenant(tenantId, db.prisma).billingAuditLog.findMany();
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["customer_created", "subscribe", "entitlement_granted", "payment_paid"]));
  });

  it("CPF inválido não chega ao Asaas", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    await expect(
      subscribe(depsOf(fake, T0), { tenantId, planCode: "starter", cycle: "MONTHLY", name: "Ana", document: "111.111.111-11", email: "a@x.com" }),
    ).rejects.toThrow("CPF ou CNPJ inválido.");
    expect(fake.calls).toEqual([]);
  });
});

describe("BRECHAS FECHADAS", () => {
  it("teste grátis: assinar Agência não libera a Agência", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "agency", cycle: "MONTHLY", name: "Ana", document: nextCpf(), email: "a@x.com" });
    expect(await plan(tenantId, T0)).toBe("starter");
  });

  it("aviso FORJADO (token válido, corpo dizendo 'pago'): a API diz pendente -> nada libera", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "agency", cycle: "MONTHLY", name: "Ana", document: nextCpf(), email: "a@x.com" });
    const real = [...fake.payments.values()][0]!;
    const forged = { ...real, status: "RECEIVED", paymentDate: "2026-10-06" };
    const outcome = await handleWebhookEvent({ client: db.prisma, asaas: fake.client, now: T0 }, { id: `evt_forged_${tenantId}`, event: "PAYMENT_RECEIVED", payment: forged });
    expect(outcome).toBe("processed");
    expect(await plan(tenantId, T0)).toBe("starter");
    expect((await forTenant(tenantId, db.prisma).payment.findFirstOrThrow()).paidAt).toBeNull();
  });

  it("valor pago diferente do esperado: não libera, marca revisão e avisa os administradores", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    const notices: BillingNotice[] = [];
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "agency", cycle: "MONTHLY", name: "Ana", document: nextCpf(), email: "a@x.com" });
    const invoice = [...fake.payments.values()][0]!;
    invoice.value = 47; // alguém mexeu no valor da cobrança no Asaas
    await syncPayment(depsOf(fake, at("2026-10-13T15:00:00Z"), notices), fake.pay(invoice.id, "2026-10-13"));
    expect(await plan(tenantId, at("2026-10-13T16:00:00Z"))).not.toBe("agency");
    const row = await forTenant(tenantId, db.prisma).payment.findFirstOrThrow();
    expect(row.reviewReason).toContain("esperado era R$ 197.00");
    expect(notices).toEqual([expect.objectContaining({ kind: "review", tenantId, asaasPaymentId: invoice.id })]);
    expect(await forTenant(tenantId, db.prisma).entitlement.count({ where: { source: "PAYMENT" } })).toBe(0);
  });

  it("dois cliques em 'Assinar' ao mesmo tempo: uma assinatura só", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    const input = { tenantId, planCode: "starter", cycle: "MONTHLY" as const, name: "Ana", document: nextCpf(), email: "a@x.com" };
    const results = await Promise.allSettled([subscribe(depsOf(fake, T0), input), subscribe(depsOf(fake, T0), input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fake.subscriptions.size).toBe(1);
  });

  it("CPF já usado em outra conta: sem teste grátis (cobra hoje e envios pausam até pagar)", async () => {
    const fake = new FakeAsaas();
    const cpf = nextCpf();
    const first = await newTenant();
    await subscribe(depsOf(fake, T0), { tenantId: first, planCode: "starter", cycle: "MONTHLY", name: "Ana", document: cpf, email: "a@x.com" });
    const second = await newTenant();
    const result = await subscribe(depsOf(fake, T0), { tenantId: second, planCode: "starter", cycle: "MONTHLY", name: "Ana", document: cpf, email: "b@x.com" });
    expect(result.trialRemoved).toBe(true);
    expect([...fake.subscriptions.values()].at(-1)!.nextDueDate).toBe("2026-10-06");
    expect((await getSendingBlock(second, { client: db.prisma, now: T0 }))?.reason).toBe("TRIAL_ENDED");
    expect(await getSendingBlock(first, { client: db.prisma, now: T0 })).toBeNull();
  });

  it("contestação da diferença do upgrade: o plano maior é revogado e o anterior volta", async () => {
    const fake = new FakeAsaas();
    const { tenantId } = await paying(fake);
    const now = at("2026-10-28T15:00:00Z");
    await changePlan(depsOf(fake, now), tenantId, "pro", "MONTHLY");
    const extra = [...fake.payments.values()].find((p) => !p.subscription)!;
    expect(extra.value).toBe(25.81);
    await syncPayment(depsOf(fake, now), fake.pay(extra.id, "2026-10-28"));
    expect(await plan(tenantId, now)).toBe("pro");
    const notices: BillingNotice[] = [];
    extra.status = "CHARGEBACK_REQUESTED";
    await syncPayment(depsOf(fake, at("2026-10-29T12:00:00Z"), notices), extra);
    expect(await plan(tenantId, at("2026-10-29T12:00:00Z"))).toBe("starter");
    expect(notices).toHaveLength(1);
  });

  it("assinatura órfã no Asaas (cobraria em dobro) é cancelada na conferência", async () => {
    const fake = new FakeAsaas();
    const { tenantId } = await paying(fake);
    const customer = (await db.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).asaasCustomerId!;
    await fake.client.createSubscription({ customer, value: 47, nextDueDate: "2026-11-13", cycle: "MONTHLY", description: "x", externalReference: tenantId });
    const result = await reconcileTenant(depsOf(fake, at("2026-10-20T12:00:00Z")), tenantId);
    expect(result.orphans).toBe(1);
    expect([...fake.subscriptions.values()].filter((s) => !s.deleted)).toHaveLength(1);
  });
});

describe("pausa dos envios", () => {
  it("e-mail do dono não confirmado: envios pausados", async () => {
    const tenantId = await newTenant(false);
    expect((await getSendingBlock(tenantId, { client: db.prisma, now: T0 }))?.reason).toBe("EMAIL_NOT_VERIFIED");
  });

  it("teste grátis vencido sem pagamento: pausa na hora", async () => {
    const tenantId = await newTenant();
    expect(await getSendingBlock(tenantId, { client: db.prisma, now: T0 })).toBeNull();
    expect((await getSendingBlock(tenantId, { client: db.prisma, now: new Date(T0.getTime() + 7 * DAY + 60_000) }))?.reason).toBe("TRIAL_ENDED");
  });

  it("pagou e atrasou: 5 dias de tolerância, depois pausa; pagou de novo, volta", async () => {
    const fake = new FakeAsaas();
    const { tenantId, subId } = await paying(fake);
    const next = fake.nextInvoice(subId, "2026-11-13");
    await syncPayment(depsOf(fake, at("2026-11-14T12:00:00Z")), fake.overdue(next.id));
    const block = (iso: string) => getSendingBlock(tenantId, { client: db.prisma, now: at(iso) });
    expect(await block("2026-11-17T12:00:00Z")).toBeNull(); // 4 dias
    expect((await block("2026-11-19T12:00:00Z"))?.reason).toBe("PAST_DUE"); // 6 dias
    await syncPayment(depsOf(fake, at("2026-11-19T12:00:00Z")), fake.pay(next.id, "2026-11-19"));
    expect(await block("2026-11-19T13:00:00Z")).toBeNull();
  });
});

describe("webhook", () => {
  it("token em tempo constante; evento repetido não aplica de novo; sem chave de API não aplica", async () => {
    expect(isValidWebhookToken("um-token-bem-grande-123", "um-token-bem-grande-123")).toBe(true);
    expect(isValidWebhookToken("outro", "um-token-bem-grande-123")).toBe(false);
    expect(isValidWebhookToken("curto", "curto")).toBe(false);

    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "starter", cycle: "MONTHLY", name: "Ana", document: nextCpf(), email: "a@x.com" });
    const payment = fake.pay([...fake.payments.keys()][0]!, "2026-10-13");
    const now = at("2026-10-13T15:00:00Z");
    expect(await handleWebhookEvent({ client: db.prisma, asaas: null, now }, { id: `evt_nokey_${tenantId}`, event: "PAYMENT_RECEIVED", payment })).toBe("not-configured");
    // Teste grátis já acabou e o aviso não foi aplicado: sem direito de uso (plano básico, sem envios).
    expect(await plan(tenantId, now)).toBe("catalog");
    const event = { id: `evt_${tenantId}`, event: "PAYMENT_RECEIVED", payment };
    expect(await handleWebhookEvent({ client: db.prisma, asaas: fake.client, now }, event)).toBe("processed");
    expect(await handleWebhookEvent({ client: db.prisma, asaas: fake.client, now }, event)).toBe("duplicate");
    expect((await getCurrentSubscription(tenantId, { client: db.prisma, now }))?.status).toBe("ACTIVE");
  });
});

describe("troca de plano", () => {
  it("descer: o plano maior segue até o fim do pago; o menor vale com a próxima cobrança paga", async () => {
    const fake = new FakeAsaas();
    const { tenantId, subId } = await paying(fake, "pro");
    expect((await changePlan(depsOf(fake, at("2026-10-20T15:00:00Z")), tenantId, "starter", "MONTHLY")).kind).toBe("scheduled");
    expect(fake.subscriptions.get(subId)!.value).toBe(47);
    expect(await plan(tenantId, at("2026-11-12T12:00:00Z"))).toBe("pro");
    const next = fake.nextInvoice(subId, "2026-11-13");
    await syncPayment(depsOf(fake, at("2026-11-13T15:00:00Z")), fake.pay(next.id, "2026-11-13"));
    expect(await plan(tenantId, at("2026-11-14T12:00:00Z"))).toBe("starter");
  });

  it("mensal -> anual: vale só quando a cobrança da assinatura nova for paga", async () => {
    const fake = new FakeAsaas();
    const { tenantId } = await paying(fake);
    await changePlan(depsOf(fake, at("2026-10-20T15:00:00Z")), tenantId, "starter", "YEARLY");
    const [oldSub, newSub] = [...fake.subscriptions.values()];
    expect(oldSub!.deleted).toBe(true);
    expect(newSub).toMatchObject({ value: 467, cycle: "YEARLY", nextDueDate: "2026-11-13" });
    const invoice = [...fake.payments.values()].find((p) => p.subscription === newSub!.id)!;
    await syncPayment(depsOf(fake, at("2026-11-13T15:00:00Z")), fake.pay(invoice.id, "2026-11-13"));
    expect(await getCurrentSubscription(tenantId, { client: db.prisma, now: at("2026-11-13T16:00:00Z") })).toMatchObject({
      billingCycle: "YEARLY",
      currentPeriodEnd: at("2027-11-13T03:00:00Z"),
    });
  });
});

describe("cancelar e estornar", () => {
  it("cancelar: o Asaas para de cobrar na hora; usa até o fim do pago; depois, sem assinatura", async () => {
    const fake = new FakeAsaas();
    const { tenantId, subId } = await paying(fake);
    const { until } = await cancelSubscription(depsOf(fake, at("2026-10-20T15:00:00Z")), tenantId);
    expect(until).toEqual(at("2026-11-13T03:00:00Z"));
    expect(fake.subscriptions.get(subId)!.deleted).toBe(true);
    expect(await getCurrentSubscription(tenantId, { client: db.prisma, now: at("2026-11-13T04:00:00Z") })).toBeNull();
  });

  it("estorno com arrependimento: devolve no Asaas, revoga o direito e encerra o acesso", async () => {
    const fake = new FakeAsaas();
    const { tenantId } = await paying(fake);
    const payment = await forTenant(tenantId, db.prisma).payment.findFirstOrThrow({ where: { paidAt: { not: null } } });
    await refundPayment({ ...depsOf(fake, at("2026-10-15T15:00:00Z")), actor: { type: "ADMIN", userId: "admin-1" } }, payment.id, { cancelSubscription: true });
    expect(fake.payments.get(payment.asaasPaymentId)!.status).toBe("REFUNDED");
    expect(await getCurrentSubscription(tenantId, { client: db.prisma, now: at("2026-10-15T16:00:00Z") })).toBeNull();
    const refundLog = await forTenant(tenantId, db.prisma).billingAuditLog.findFirstOrThrow({ where: { action: "refund" } });
    expect(refundLog).toMatchObject({ actor: "ADMIN", actorUserId: "admin-1" });
  });
});

describe("conferência", () => {
  it("pagamento sem webhook (aviso perdido) é aplicado na conferência", async () => {
    const fake = new FakeAsaas();
    const tenantId = await newTenant();
    await subscribe(depsOf(fake, T0), { tenantId, planCode: "starter", cycle: "MONTHLY", name: "Ana", document: nextCpf(), email: "a@x.com" });
    fake.pay([...fake.payments.keys()][0]!, "2026-10-13");
    await reconcileTenant(depsOf(fake, at("2026-10-13T15:00:00Z")), tenantId);
    expect((await getCurrentSubscription(tenantId, { client: db.prisma, now: at("2026-10-14T12:00:00Z") }))?.status).toBe("ACTIVE");
  });
});
