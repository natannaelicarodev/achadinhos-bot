import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authenticate,
  createPasswordResetToken,
  resetPasswordWithToken,
  signUp,
} from "@/lib/auth/accounts";
import { rateLimit } from "@/lib/auth/rate-limit";
import { signUpSchema } from "@/lib/auth/schemas";
import { SESSION_DURATION_MS } from "@/lib/auth/cookie";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { TERMS_VERSION } from "@/lib/terms";
import { createEmailVerification, verifyEmailToken } from "@/lib/auth/email-verification";
import { getCurrentSubscription } from "@achadinhos/db";

let db: TestDatabase;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

function input(email: string) {
  return signUpSchema.parse({ tenantName: "Achadinhos da Ana", name: "Ana", email, password: "senha-forte-123", acceptTerms: "on" });
}

describe("cadastro", () => {
  it("cria tenant, usuário OWNER e trial de 7 dias no Iniciante", async () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const result = await signUp(db.prisma, input("ana@teste.com"), now);
    expect(result.ok).toBe(true);

    const user = await db.prisma.user.findUniqueOrThrow({
      where: { email: "ana@teste.com" },
      include: { tenant: { include: { subscriptions: { include: { plan: true } } } } },
    });
    expect(user.role).toBe("OWNER");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.tenant.slug).toMatch(/^achadinhos-da-ana-[0-9a-f]{6}$/);
    const [sub] = user.tenant.subscriptions;
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan.code).toBe("starter");
    expect(sub?.trialEndsAt?.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("SEGURANÇA: e-mail da lista de administradores só vira administrador depois de confirmar o e-mail", async () => {
    const list = "outra@x.com, dona@teste.com";
    const data = signUpSchema.parse({ tenantName: "Loja da Dona", name: "Dona", email: "Dona@Teste.com", password: "senha-forte-123", acceptTerms: "on" });
    const now = new Date("2026-10-04T12:00:00Z");
    const result = await signUp(db.prisma, data, now);
    expect(result.ok).toBe(true);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "dona@teste.com" } });
    expect(user.emailVerifiedAt).toBeNull();
    expect((await getCurrentSubscription(user.tenantId, { client: db.prisma, now }))?.plan.code).toBe("starter");

    const created = await createEmailVerification(db.prisma, user.id, now);
    expect(created.ok).toBe(true);
    // Reenvio em menos de 2 minutos: recusado.
    expect(await createEmailVerification(db.prisma, user.id, new Date(now.getTime() + 60_000))).toMatchObject({ ok: false, reason: "TOO_SOON" });
    // Link errado não confirma.
    expect((await verifyEmailToken(db.prisma, "token-errado-bem-grande-123", now, list)).ok).toBe(false);
    if (!created.ok) throw new Error("sem token");
    expect((await verifyEmailToken(db.prisma, created.token, now, list)).ok).toBe(true);
    // Uso único.
    expect((await verifyEmailToken(db.prisma, created.token, now, list)).ok).toBe(false);
    expect((await getCurrentSubscription(user.tenantId, { client: db.prisma, now }))?.plan.code).toBe("admin");
  });

  it("link de confirmação vence em 24 horas", async () => {
    const data = signUpSchema.parse({ tenantName: "Loja Venc", name: "Vê", email: "vence@teste.com", password: "senha-forte-123", acceptTerms: "on" });
    const now = new Date("2026-10-04T12:00:00Z");
    const result = await signUp(db.prisma, data, now);
    if (!result.ok) throw new Error("falhou");
    const created = await createEmailVerification(db.prisma, result.userId, now);
    if (!created.ok) throw new Error("sem token");
    expect((await verifyEmailToken(db.prisma, created.token, new Date(now.getTime() + 25 * 3_600_000))).ok).toBe(false);
  });

  it("normaliza e-mail e recusa duplicado", async () => {
    expect(input("  ANA@Teste.com ").email).toBe("ana@teste.com");
    const again = await signUp(db.prisma, input("ANA@teste.com"));
    expect(again).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expect(await db.prisma.tenant.count({ where: { name: "Achadinhos da Ana" } })).toBe(1);
  });

  it("exige aceitar os Termos de uso e grava a versão aceita", async () => {
    expect(signUpSchema.safeParse({ tenantName: "Loja", name: "Bia", email: "bia@teste.com", password: "senha-forte-123" }).success).toBe(false);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "ana@teste.com" } });
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it("recusa senha curta", () => {
    expect(
      signUpSchema.safeParse({ tenantName: "Loja", name: "Bia", email: "bia@teste.com", password: "123" }).success,
    ).toBe(false);
  });
});

describe("login", () => {
  it("aceita senha certa e recusa senha errada ou e-mail inexistente", async () => {
    await signUp(db.prisma, input("login@teste.com"));
    expect(await authenticate(db.prisma, "login@teste.com", "senha-forte-123")).not.toBeNull();
    expect(await authenticate(db.prisma, "login@teste.com", "senha-errada")).toBeNull();
    expect(await authenticate(db.prisma, "ninguem@teste.com", "senha-forte-123")).toBeNull();
  });
});

describe("sessão", () => {
  it("guarda só o hash do token e valida o token original", async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "login@teste.com" } });
    const { token } = await createSession(db.prisma, user.id);

    expect(await db.prisma.session.findUnique({ where: { id: token } })).toBeNull();
    expect(await db.prisma.session.findUnique({ where: { id: hashToken(token) } })).not.toBeNull();

    const result = await validateSessionToken(db.prisma, token);
    expect(result?.user.id).toBe(user.id);
    expect(result?.user.tenantId).toBe(user.tenantId);
    expect(await validateSessionToken(db.prisma, "token-inventado")).toBeNull();
  });

  it("sessão expirada é recusada e apagada", async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "login@teste.com" } });
    const start = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(db.prisma, user.id, start);
    const later = new Date(start.getTime() + SESSION_DURATION_MS + 1);
    expect(await validateSessionToken(db.prisma, token, later)).toBeNull();
    expect(await db.prisma.session.findUnique({ where: { id: hashToken(token) } })).toBeNull();
  });

  it("renova a validade quando passou da metade", async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "login@teste.com" } });
    const start = new Date("2026-02-01T00:00:00Z");
    const { token } = await createSession(db.prisma, user.id, start);
    const now = new Date(start.getTime() + 20 * DAY);
    const result = await validateSessionToken(db.prisma, token, now);
    expect(result?.session.expiresAt.getTime()).toBe(now.getTime() + SESSION_DURATION_MS);
  });
});

describe("recuperação de senha", () => {
  it("e-mail inexistente não gera token", async () => {
    expect(await createPasswordResetToken(db.prisma, "ninguem@teste.com")).toBeNull();
  });

  it("troca a senha, derruba sessões e o token só vale uma vez", async () => {
    await signUp(db.prisma, input("reset@teste.com"));
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "reset@teste.com" } });
    const { token: sessionToken } = await createSession(db.prisma, user.id);

    const reset = await createPasswordResetToken(db.prisma, "reset@teste.com");
    expect(reset).not.toBeNull();
    const stored = await db.prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashToken(reset!.token));

    expect(await resetPasswordWithToken(db.prisma, reset!.token, "nova-senha-456")).toBe("ok");
    expect(await authenticate(db.prisma, "reset@teste.com", "nova-senha-456")).not.toBeNull();
    expect(await authenticate(db.prisma, "reset@teste.com", "senha-forte-123")).toBeNull();
    expect(await validateSessionToken(db.prisma, sessionToken)).toBeNull();

    expect(await resetPasswordWithToken(db.prisma, reset!.token, "outra-senha-789")).toBe("invalid");
  });

  it("token expirado (1h) é recusado", async () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const reset = await createPasswordResetToken(db.prisma, "reset@teste.com", now);
    const later = new Date(now.getTime() + 60 * 60 * 1000 + 1);
    expect(await resetPasswordWithToken(db.prisma, reset!.token, "senha-nova-000", later)).toBe("invalid");
  });

  it("pedir novo link invalida o anterior", async () => {
    const first = await createPasswordResetToken(db.prisma, "reset@teste.com");
    const second = await createPasswordResetToken(db.prisma, "reset@teste.com");
    expect(await resetPasswordWithToken(db.prisma, first!.token, "senha-nova-111")).toBe("invalid");
    expect(await resetPasswordWithToken(db.prisma, second!.token, "senha-nova-222")).toBe("ok");
  });
});

describe("limite de tentativas", () => {
  it("bloqueia depois do limite e libera após a janela", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimit("teste", 5, 60_000, t0)).toBe(true);
    expect(rateLimit("teste", 5, 60_000, t0)).toBe(false);
    expect(rateLimit("teste", 5, 60_000, t0 + 60_001)).toBe(true);
  });
});
