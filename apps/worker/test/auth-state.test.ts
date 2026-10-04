import { randomBytes } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usePostgresAuthState } from "../src/whatsapp/auth-state";
import { createTenantWithChannel, SESSION_KEY } from "./helpers";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe("auth state no PostgreSQL", () => {
  it("sem sessão salva começa com creds novas; saveCreds persiste e recarrega igual", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-creds");
    const opts = { tenantId: tenant.id, channelId: channel.id, key: SESSION_KEY, client: db.prisma };

    const first = await usePostgresAuthState(opts);
    expect(first.hadSession).toBe(false);
    first.state.creds.me = { id: "5511999999999:1@s.whatsapp.net", name: "Loja" };
    await first.saveCreds();

    const again = await usePostgresAuthState(opts);
    expect(again.hadSession).toBe(true);
    expect(again.state.creds.me?.id).toBe("5511999999999:1@s.whatsapp.net");
    // Buffers sobrevivem à ida e volta (BufferJSON).
    expect(Buffer.isBuffer(again.state.creds.noiseKey.private)).toBe(true);
    expect(Buffer.from(again.state.creds.noiseKey.private)).toEqual(Buffer.from(first.state.creds.noiseKey.private));
  });

  it("keys: set grava, get lê, null apaga; tipos novos do v7 funcionam", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-keys");
    const { state } = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });

    const preKey = { private: randomBytes(32), public: randomBytes(32) };
    await state.keys.set({
      "pre-key": { "1": preKey, "2": preKey },
      "lid-mapping": { "5511999999999": "123456789@lid" },
      "device-list": { "5511999999999": ["0", "1"] },
      session: { "abc.0": new Uint8Array([1, 2, 3]) },
    });

    const got = await state.keys.get("pre-key", ["1", "2", "3"]);
    expect(Object.keys(got).sort()).toEqual(["1", "2"]);
    expect(Buffer.from(got["1"]!.private)).toEqual(preKey.private);
    expect(await state.keys.get("lid-mapping", ["5511999999999"])).toEqual({ "5511999999999": "123456789@lid" });
    expect(await state.keys.get("device-list", ["5511999999999"])).toEqual({ "5511999999999": ["0", "1"] });
    expect(Buffer.from((await state.keys.get("session", ["abc.0"]))["abc.0"]!)).toEqual(Buffer.from([1, 2, 3]));

    await state.keys.set({ "pre-key": { "1": null } });
    expect(Object.keys(await state.keys.get("pre-key", ["1", "2"]))).toEqual(["2"]);
  });

  it("lote grande: 812 pre-keys (1ª conexão) + centenas de sessões numa chamada só", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-lote");
    const { state } = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });

    const preKeys = Object.fromEntries(
      Array.from({ length: 812 }, (_, i) => [String(i + 1), { private: randomBytes(32), public: randomBytes(32) }]),
    );
    const sessions = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`5511${String(i).padStart(9, "0")}.0`, randomBytes(64)]),
    );
    await state.keys.set({ "pre-key": preKeys, session: sessions });

    expect(await db.prisma.whatsAppSessionKey.count({ where: { channelId: channel.id } })).toBe(1112);
    const sample = await state.keys.get("pre-key", ["1", "406", "812"]);
    expect(Buffer.from(sample["812"]!.public)).toEqual(preKeys["812"]!.public);
    const sessionIds = Object.keys(sessions).slice(0, 250);
    expect(Object.keys(await state.keys.get("session", sessionIds))).toHaveLength(250);
  });

  it("sobrescreve chave existente e apaga outra na mesma chamada", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-sobrescreve");
    const { state } = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await state.keys.set({ session: { a: new Uint8Array([1]), b: new Uint8Array([2]) } });
    await state.keys.set({ session: { a: new Uint8Array([9]), b: null, c: new Uint8Array([3]) } });

    const got = await state.keys.get("session", ["a", "b", "c"]);
    expect(Object.keys(got).sort()).toEqual(["a", "c"]);
    expect(Buffer.from(got.a!)).toEqual(Buffer.from([9]));
    expect(await db.prisma.whatsAppSessionKey.count({ where: { channelId: channel.id } })).toBe(2);
  });

  it("tudo ou nada: se o banco falhar no meio do lote, nenhuma chave muda", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-atomico");
    const { state } = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await state.keys.set({ session: { s1: new Uint8Array([1]) }, "pre-key": { p1: { private: randomBytes(32), public: randomBytes(32) } } });

    // Trigger de teste: o banco recusa a chave "explode" (simula queda no meio da transação).
    await db.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_on_explode() RETURNS trigger AS $$
      BEGIN
        IF NEW."keyId" = 'explode' THEN RAISE EXCEPTION 'falha simulada'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await db.prisma.$executeRawUnsafe(
      `CREATE TRIGGER explode BEFORE INSERT ON "WhatsAppSessionKey" FOR EACH ROW EXECUTE FUNCTION fail_on_explode()`,
    );
    try {
      await expect(
        state.keys.set({
          session: { s1: new Uint8Array([7]), s2: new Uint8Array([8]) }, // tipo gravado antes da falha
          "pre-key": { p1: null, explode: { private: randomBytes(32), public: randomBytes(32) } },
        }),
      ).rejects.toThrow();
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TRIGGER explode ON "WhatsAppSessionKey"`);
    }

    // Nada da chamada que falhou ficou salvo: s1 antigo, sem s2, p1 continua lá.
    const sessions = await state.keys.get("session", ["s1", "s2"]);
    expect(Object.keys(sessions)).toEqual(["s1"]);
    expect(Buffer.from(sessions.s1!)).toEqual(Buffer.from([1]));
    expect(Object.keys(await state.keys.get("pre-key", ["p1"]))).toEqual(["p1"]);
  });

  it("app-state-sync-key volta como objeto proto", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-appstate");
    const { state } = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await state.keys.set({ "app-state-sync-key": { k1: { keyData: new Uint8Array([9, 9]) } } });
    const got = await state.keys.get("app-state-sync-key", ["k1"]);
    expect(Buffer.from(got.k1!.keyData!)).toEqual(Buffer.from([9, 9]));
  });

  it("no banco fica só ciphertext (nada legível)", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-cipher");
    const auth = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    auth.state.creds.me = { id: "5511988887777@s.whatsapp.net" };
    await auth.saveCreds();
    await auth.state.keys.set({ "lid-mapping": { "5511988887777": "segredo@lid" } });

    const session = await db.prisma.whatsAppSession.findUniqueOrThrow({ where: { channelId: channel.id } });
    const key = await db.prisma.whatsAppSessionKey.findFirstOrThrow({ where: { channelId: channel.id } });
    expect(Buffer.from(session.ciphertext).toString("utf8")).not.toContain("5511988887777");
    expect(Buffer.from(key.ciphertext).toString("utf8")).not.toContain("segredo");
  });

  it("chave copiada para outro número não descriptografa (AAD)", async () => {
    const a = await createTenantWithChannel(db.prisma, "auth-aad-a");
    const b = await createTenantWithChannel(db.prisma, "auth-aad-b");
    const stateA = await usePostgresAuthState({
      tenantId: a.tenant.id,
      channelId: a.channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await stateA.state.keys.set({ session: { s1: new Uint8Array([7]) } });
    const rowA = await db.prisma.whatsAppSessionKey.findFirstOrThrow({ where: { channelId: a.channel.id } });
    await db.prisma.whatsAppSessionKey.create({
      data: { ...rowA, tenantId: b.tenant.id, channelId: b.channel.id },
    });

    const stateB = await usePostgresAuthState({
      tenantId: b.tenant.id,
      channelId: b.channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await expect(stateB.state.keys.get("session", ["s1"])).rejects.toThrow();
  });

  it("chave de criptografia errada não abre a sessão", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-wrongkey");
    const opts = { tenantId: tenant.id, channelId: channel.id, client: db.prisma };
    const auth = await usePostgresAuthState({ ...opts, key: SESSION_KEY });
    await auth.saveCreds();
    await expect(usePostgresAuthState({ ...opts, key: randomBytes(32) })).rejects.toThrow();
  });

  it("clear apaga sessão e todas as chaves do número", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "auth-clear");
    const auth = await usePostgresAuthState({
      tenantId: tenant.id,
      channelId: channel.id,
      key: SESSION_KEY,
      client: db.prisma,
    });
    await auth.saveCreds();
    await auth.state.keys.set({ "pre-key": { "1": { private: randomBytes(32), public: randomBytes(32) } } });
    await auth.clear();
    expect(await db.prisma.whatsAppSession.count({ where: { channelId: channel.id } })).toBe(0);
    expect(await db.prisma.whatsAppSessionKey.count({ where: { channelId: channel.id } })).toBe(0);
  });
});
