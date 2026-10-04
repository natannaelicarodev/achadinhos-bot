import { forTenant } from "@achadinhos/db";
import { createTestDatabase, type TestDatabase } from "@achadinhos/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleWhatsappJob } from "../src/queues/whatsapp";
import { selfIdsFrom, syncGroups, toGroupRows, type GroupInfo } from "../src/whatsapp/groups";
import { memoryTestSendHistory } from "../src/whatsapp/rate-limit";
import { sendOfferToWhatsApp, SendError, type WhatsAppSender } from "../src/whatsapp/send";
import { createTenantWithChannel, silentLogger } from "./helpers";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

const ME = { id: "5511999999999:3@s.whatsapp.net", lid: "777:3@lid" };
const member = (id: string, admin: string | null = null) => ({ id, admin });

function group(id: string, extra: Partial<GroupInfo> = {}): GroupInfo {
  return { id, subject: `Grupo ${id}`, participants: [member("5511999999999@s.whatsapp.net")], ...extra };
}

describe("grupos", () => {
  it("canSend: grupo só-admins exige que o número seja admin (por PN ou LID)", () => {
    const rows = toGroupRows(
      [
        group("aberto@g.us"),
        group("so-admins@g.us", { announce: true }),
        group("admin-lid@g.us", { announce: true, participants: [member("777@lid", "admin")] }),
        group("comunidade@g.us", { isCommunity: true }),
      ],
      selfIdsFrom(ME),
    );
    expect(rows.map((r) => [r.externalId, r.canSend, r.isAdmin])).toEqual([
      ["aberto@g.us", true, false],
      ["so-admins@g.us", false, false],
      ["admin-lid@g.us", true, true],
    ]);
  });

  it("isAdmin: admin e superadmin contam; vira false se o número perder o admin", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "sync-admin");
    const tdb = forTenant(tenant.id, db.prisma);
    const asAdmin = (admin: string | null) =>
      group("g@g.us", { participants: [member("5511999999999@s.whatsapp.net", admin)] });

    await syncGroups(tdb, tenant.id, channel.id, [asAdmin("superadmin")], selfIdsFrom(ME));
    expect((await tdb.group.findFirstOrThrow({ where: { externalId: "g@g.us" } })).isAdmin).toBe(true);

    await syncGroups(tdb, tenant.id, channel.id, [asAdmin(null)], selfIdsFrom(ME));
    expect((await tdb.group.findFirstOrThrow({ where: { externalId: "g@g.us" } })).isAdmin).toBe(false);
  });

  it("sincroniza: cria, atualiza e desativa (e desmarca) os que sumiram", async () => {
    const { tenant, channel } = await createTenantWithChannel(db.prisma, "sync");
    const tdb = forTenant(tenant.id, db.prisma);
    await syncGroups(tdb, tenant.id, channel.id, [group("a@g.us"), group("b@g.us", { size: 42 })], selfIdsFrom(ME));
    await tdb.group.updateMany({ where: { externalId: "a@g.us" }, data: { postingEnabled: true } });

    const result = await syncGroups(tdb, tenant.id, channel.id, [group("b@g.us", { subject: "Novo nome" })], selfIdsFrom(ME));
    expect(result).toEqual({ total: 1, removed: 1 });
    const rows = await tdb.group.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((g) => [g.externalId, g.name, g.active, g.postingEnabled])).toEqual([
      ["a@g.us", "Grupo a@g.us", false, false],
      ["b@g.us", "Novo nome", true, false],
    ]);
  });
});

function fakeSocket() {
  const sendMessage = vi.fn<WhatsAppSender["sendMessage"]>(async () => ({ key: { id: "MSG1" } }));
  return { sendMessage };
}

async function setupGroup(slug: string, data: { canSend?: boolean; active?: boolean } = {}) {
  const { tenant, channel } = await createTenantWithChannel(db.prisma, slug);
  const g = await db.prisma.group.create({
    data: { tenantId: tenant.id, channelId: channel.id, externalId: `${slug}@g.us`, name: slug, ...data },
  });
  return { tenant, channel, group: g };
}

describe("sendOfferToWhatsApp", () => {
  it("envia imagem com legenda", async () => {
    const { tenant, group: g } = await setupGroup("envio-img");
    const sock = fakeSocket();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await sendOfferToWhatsApp(
      { db: forTenant(tenant.id, db.prisma), getSocket: () => sock },
      g.id,
      image,
      "Oferta!",
    );
    expect(result).toEqual({ messageId: "MSG1", imageSent: true });
    expect(sock.sendMessage).toHaveBeenCalledWith("envio-img@g.us", { image, caption: "Oferta!" });
  });

  it("imagem por URL inválida: manda só o texto e avisa", async () => {
    const { tenant, group: g } = await setupGroup("envio-url-ruim");
    const sock = fakeSocket();
    const result = await sendOfferToWhatsApp(
      {
        db: forTenant(tenant.id, db.prisma),
        getSocket: () => sock,
        loadImage: async () => ({ ok: false, reason: "A imagem tem mais de 5 MB." }),
      },
      g.id,
      "https://x.com/grande.png",
      "Só texto",
    );
    expect(result.imageSent).toBe(false);
    expect(result.warning).toBe("Imagem não enviada: A imagem tem mais de 5 MB. A mensagem foi só com o texto.");
    expect(sock.sendMessage).toHaveBeenCalledWith("envio-url-ruim@g.us", { text: "Só texto" });
  });

  it("recusa grupo de outro tenant, número desconectado, grupo inativo e grupo só-admins", async () => {
    const a = await setupGroup("envio-a");
    const b = await setupGroup("envio-b");
    const sock = fakeSocket();
    const depsA = { db: forTenant(a.tenant.id, db.prisma), getSocket: () => sock };

    await expect(sendOfferToWhatsApp(depsA, b.group.id, null, "x")).rejects.toThrow("Grupo não encontrado.");
    await expect(
      sendOfferToWhatsApp({ ...depsA, getSocket: () => undefined }, a.group.id, null, "x"),
    ).rejects.toThrow("O número deste grupo não está conectado.");

    const inactive = await setupGroup("envio-inativo", { active: false });
    await expect(
      sendOfferToWhatsApp({ db: forTenant(inactive.tenant.id, db.prisma), getSocket: () => sock }, inactive.group.id, null, "x"),
    ).rejects.toThrow("O número não participa mais deste grupo.");

    const adminsOnly = await setupGroup("envio-admins", { canSend: false });
    await expect(
      sendOfferToWhatsApp({ db: forTenant(adminsOnly.tenant.id, db.prisma), getSocket: () => sock }, adminsOnly.group.id, null, "x"),
    ).rejects.toBeInstanceOf(SendError);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

describe("job sendTest", () => {
  function deps(now: { t: number }) {
    const send = vi.fn(async () => ({ messageId: "M", imageSent: false }));
    return {
      send,
      deps: {
        prisma: db.prisma,
        manager: {
          connect: vi.fn(),
          remove: vi.fn(),
          syncGroups: vi.fn(),
          sendOfferToWhatsApp: send,
        },
        history: memoryTestSendHistory(),
        logger: silentLogger,
        now: () => now.t,
      },
    };
  }

  it("aplica intervalo de 20s e limite de 10/hora por número, com mensagens em pt-BR", async () => {
    const { tenant, channel, group: g } = await setupGroup("job-limite");
    const now = { t: 1_000_000_000 };
    const { deps: d, send } = deps(now);
    const data = { tenantId: tenant.id, channelId: channel.id, groupId: g.id, text: "teste" };

    expect(await handleWhatsappJob(d, "sendTest", data)).toEqual({ ok: true, message: "Teste enviado." });
    now.t += 5_000;
    expect(await handleWhatsappJob(d, "sendTest", data)).toEqual({
      ok: false,
      message: "Aguarde 15s para enviar outro teste por este número.",
    });
    for (let i = 0; i < 9; i++) {
      now.t += 20_000;
      expect((await handleWhatsappJob(d, "sendTest", data)).ok).toBe(true);
    }
    now.t += 20_000;
    const blocked = await handleWhatsappJob(d, "sendTest", data);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/^Limite de 10 envios de teste por hora/);
    expect(send).toHaveBeenCalledTimes(10);
  });

  it("recusa número de outro tenant e grupo de outro número", async () => {
    const a = await setupGroup("job-a");
    const b = await setupGroup("job-b");
    const { deps: d, send } = deps({ t: 0 });

    const otherTenant = await handleWhatsappJob(d, "sendTest", {
      tenantId: a.tenant.id,
      channelId: b.channel.id,
      groupId: b.group.id,
      text: "x",
    });
    expect(otherTenant).toEqual({ ok: false, message: "Número não encontrado." });

    const otherChannel = await db.prisma.channel.create({
      data: { tenantId: a.tenant.id, type: "WHATSAPP", name: "Outro" },
    });
    const wrongGroup = await handleWhatsappJob(d, "sendTest", {
      tenantId: a.tenant.id,
      channelId: otherChannel.id,
      groupId: a.group.id,
      text: "x",
    });
    expect(wrongGroup).toEqual({ ok: false, message: "Grupo não encontrado." });
    expect(send).not.toHaveBeenCalled();
  });

  it("payload inválido e comando desconhecido viram erro amigável", async () => {
    const { deps: d } = deps({ t: 0 });
    expect(await handleWhatsappJob(d, "sendTest", { tenantId: "x" })).toEqual({
      ok: false,
      message: "Dados do comando inválidos.",
    });
    expect(await handleWhatsappJob(d, "apagarTudo", {})).toEqual({ ok: false, message: "Comando desconhecido." });
  });
});
