import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChannelLocks } from "../src/whatsapp/lock";
import { WhatsAppManager } from "../src/whatsapp/manager";
import { REASONS } from "../src/whatsapp/reconnect";
import { createTenantWithChannel, SESSION_KEY, silentLogger } from "./helpers";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe("início do worker", () => {
  it("pareamento interrompido (Conectando/QR sem sessão) volta para Desconectado; os demais ficam", async () => {
    const { tenant, channel: stuck } = await createTenantWithChannel(db.prisma, "reset");
    await db.prisma.channel.update({ where: { id: stuck.id }, data: { status: "QR_PENDING" } });
    const withSession = await db.prisma.channel.create({
      data: { tenantId: tenant.id, type: "WHATSAPP", name: "Com sessão", status: "CONNECTING" },
    });
    await db.prisma.whatsAppSession.create({
      data: {
        tenantId: tenant.id,
        channelId: withSession.id,
        ciphertext: new Uint8Array([1]),
        iv: new Uint8Array(12),
        authTag: new Uint8Array(16),
      },
    });

    const manager = new WhatsAppManager({
      prisma: db.prisma,
      redis: {} as Redis,
      locks: {} as ChannelLocks,
      sessionKey: SESSION_KEY,
      logger: silentLogger,
    });
    expect(await manager.resetInterruptedPairings()).toBe(1);

    const after = await db.prisma.channel.findMany({ where: { tenantId: tenant.id }, orderBy: { name: "asc" } });
    expect(after.map((c) => [c.name, c.status, c.statusReason])).toEqual([
      ["Com sessão", "CONNECTING", null],
      ["WhatsApp 1", "DISCONNECTED", REASONS.interrupted],
    ]);
  });
});
