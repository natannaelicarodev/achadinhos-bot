// Um socket Baileys por número: conecta, reconecta com backoff, trata logout.
import {
  assertChannelWithinWhatsappLimit,
  forTenant,
  PlanLimitError,
  type ChannelStatus,
  type PrismaClient,
} from "@achadinhos/db";
import { QR_TTL_SECONDS, redisKeys } from "@achadinhos/jobs";
import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type GroupMetadata,
  type proto,
  type WASocket,
} from "baileys";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { usePostgresAuthState, type PostgresAuthState } from "./auth-state";
import { syncGroups, selfIdsFrom } from "./groups";
import { LOCK_TTL_MS, type ChannelLocks } from "./lock";
import { decideOnClose, REASONS } from "./reconnect";
import { SendError, sendOfferToWhatsApp, type SendResult, type WhatsAppSender } from "./send";

const GROUP_CACHE_TTL_MS = 5 * 60_000;
const SENT_CACHE_SIZE = 500;
const STARTUP_STAGGER_MS = 1_500;
const LOCK_RENEW_EVERY_MS = 20_000;
/** Ao ligar, se a trava do número ainda estiver com o processo anterior: tentativas depois que ela expira. */
const STARTUP_LOCK_RETRIES = 3;

interface Connection {
  tenantId: string;
  channelId: string;
  auth: PostgresAuthState;
  sock?: WASocket;
  open: boolean;
  attempt: number;
  stopped: boolean;
  timer?: NodeJS.Timeout;
  groupCache: Map<string, { meta: GroupMetadata; at: number }>;
  /** Últimas mensagens enviadas: o WhatsApp pode pedir reenvio (getMessage). */
  sent: Map<string, proto.IMessage>;
}

export interface ManagerDeps {
  prisma: PrismaClient;
  redis: Redis;
  locks: ChannelLocks;
  sessionKey: Buffer;
  logger: Logger;
}

function statusCodeOf(error: unknown): number | undefined {
  const output = (error as { output?: { statusCode?: unknown } } | undefined)?.output;
  return typeof output?.statusCode === "number" ? output.statusCode : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WhatsAppManager {
  private readonly connections = new Map<string, Connection>();
  private version: Promise<[number, number, number] | undefined> | undefined;
  private renewTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: ManagerDeps) {}

  private get log() {
    return this.deps.logger;
  }

  /**
   * Ao iniciar, antes de ouvir a fila: números que ficaram em "Conectando"/"QR"
   * sem sessão salva (worker caiu no meio do pareamento) voltam para Desconectado.
   */
  async resetInterruptedPairings(): Promise<number> {
    const { count } = await this.deps.prisma.channel.updateMany({
      where: { type: "WHATSAPP", status: { in: ["CONNECTING", "QR_PENDING"] }, whatsAppSession: { is: null } },
      data: { status: "DISCONNECTED", statusReason: REASONS.interrupted },
    });
    return count;
  }

  /** Ao iniciar: reconecta todos os números com sessão salva que não foram deslogados. */
  async startAll(): Promise<void> {
    this.renewTimer ??= setInterval(() => void this.renewLocks(), LOCK_RENEW_EVERY_MS);
    const channels = await this.deps.prisma.channel.findMany({
      where: { type: "WHATSAPP", status: { not: "LOGGED_OUT" }, whatsAppSession: { isNot: null } },
      select: { id: true, tenantId: true },
      orderBy: { createdAt: "asc" },
    });
    this.log.info({ count: channels.length }, "[whatsapp] reconectando números salvos");
    for (const channel of channels) {
      try {
        await this.connect(channel.tenantId, channel.id);
      } catch (error) {
        this.log.warn({ channelId: channel.id, err: error }, "[whatsapp] número não reconectado");
        // Reinício rápido (ex.: Ctrl+C no Windows): a trava do processo anterior pode
        // continuar no Redis até expirar. Tenta de novo depois do prazo da trava.
        if (error instanceof SendError) this.retryConnectAfterLock(channel.tenantId, channel.id);
      }
      await sleep(STARTUP_STAGGER_MS);
    }
  }

  private retryConnectAfterLock(tenantId: string, channelId: string, attempt = 1): void {
    if (attempt > STARTUP_LOCK_RETRIES) return;
    const timer = setTimeout(() => {
      if (this.connections.get(channelId)?.open) return;
      this.connect(tenantId, channelId)
        .then(() => this.log.info({ channelId }, "[whatsapp] número reconectado depois da trava expirar"))
        .catch((error: unknown) => {
          this.log.warn({ channelId, err: error, attempt }, "[whatsapp] trava ainda ocupada; nova tentativa");
          this.retryConnectAfterLock(tenantId, channelId, attempt + 1);
        });
    }, LOCK_TTL_MS + 5_000);
    timer.unref?.();
  }

  /** Conecta (ou reconecta) um número. Sem sessão salva, gera QR Code. */
  async connect(tenantId: string, channelId: string): Promise<void> {
    this.renewTimer ??= setInterval(() => void this.renewLocks(), LOCK_RENEW_EVERY_MS);
    try {
      await assertChannelWithinWhatsappLimit(tenantId, channelId, { client: this.deps.prisma });
    } catch (error) {
      if (error instanceof PlanLimitError) await this.setStatus(tenantId, channelId, "ERROR", error.message);
      throw error;
    }

    const current = this.connections.get(channelId);
    if (current?.open) return;
    if (current) await this.shutdown(current, { releaseLock: false });

    if (!(await this.deps.locks.acquire(channelId))) {
      throw new SendError("Este número já está aberto em outro worker.");
    }

    const auth = await usePostgresAuthState({
      tenantId,
      channelId,
      key: this.deps.sessionKey,
      client: this.deps.prisma,
    });
    const connection: Connection = {
      tenantId,
      channelId,
      auth,
      open: false,
      attempt: 0,
      stopped: false,
      groupCache: new Map(),
      sent: new Map(),
    };
    this.connections.set(channelId, connection);
    await this.setStatus(tenantId, channelId, "CONNECTING", null);
    await this.openSocket(connection);
  }

  private async getVersion() {
    // Versão do WhatsApp Web recomendada pelo Baileys (uma consulta por processo).
    this.version ??= fetchLatestBaileysVersion()
      .then((r) => r.version)
      .catch(() => undefined);
    return this.version;
  }

  private async openSocket(connection: Connection): Promise<void> {
    if (connection.stopped) return;
    const version = await this.getVersion();
    // Logs internos do Baileys só a partir de warn (em info eles inundam o terminal).
    const logger = this.log.child({ channelId: connection.channelId }, { level: "warn" });

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: connection.auth.state.creds,
        keys: makeCacheableSignalKeyStore(connection.auth.state.keys, logger),
      },
      logger,
      browser: Browsers.macOS("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      cachedGroupMetadata: async (jid) => {
        const hit = connection.groupCache.get(jid);
        return hit && Date.now() - hit.at < GROUP_CACHE_TTL_MS ? hit.meta : undefined;
      },
      getMessage: async (key) => (key.id ? connection.sent.get(key.id) : undefined),
    });
    connection.sock = sock;

    sock.ev.on("creds.update", () => {
      connection.auth.saveCreds().catch((err: unknown) => logger.error({ err }, "[whatsapp] falha ao salvar creds"));
    });
    sock.ev.on("connection.update", (update) => {
      this.onConnectionUpdate(connection, sock, update).catch((err: unknown) =>
        logger.error({ err }, "[whatsapp] erro ao tratar connection.update"),
      );
    });
    const invalidate = (ids: (string | undefined | null)[]) => ids.forEach((id) => id && connection.groupCache.delete(id));
    sock.ev.on("groups.update", (updates) => invalidate(updates.map((u) => u.id)));
    sock.ev.on("group-participants.update", (update) => invalidate([update.id]));
  }

  private async onConnectionUpdate(connection: Connection, sock: WASocket, update: Partial<ConnectionState>) {
    if (connection.sock !== sock || connection.stopped) return; // socket antigo
    const { tenantId, channelId } = connection;

    if (update.qr) {
      await this.deps.redis.set(redisKeys.qr(channelId), update.qr, "EX", QR_TTL_SECONDS);
      await this.setStatus(tenantId, channelId, "QR_PENDING", null);
    }

    if (update.connection === "open") {
      connection.open = true;
      connection.attempt = 0;
      await this.deps.redis.del(redisKeys.qr(channelId));
      const phone = sock.user?.id ? jidNormalizedUser(sock.user.id).split("@")[0] : undefined;
      await forTenant(tenantId, this.deps.prisma).channel.updateMany({
        where: { id: channelId },
        data: {
          status: "CONNECTED",
          statusReason: null,
          lastConnectedAt: new Date(),
          ...(phone ? { externalId: phone } : {}),
        },
      });
      // Aquecimento (7 dias) conta da PRIMEIRA conexão; reconectar não reinicia.
      await forTenant(tenantId, this.deps.prisma).channel.updateMany({
        where: { id: channelId, firstConnectedAt: null },
        data: { firstConnectedAt: new Date() },
      });
      this.log.info({ channelId }, "[whatsapp] conectado");
      await this.syncGroups(tenantId, channelId).catch((err: unknown) =>
        this.log.warn({ channelId, err }, "[whatsapp] falha ao sincronizar grupos"),
      );
    }

    if (update.connection === "close") {
      connection.open = false;
      const decision = decideOnClose({
        statusCode: statusCodeOf(update.lastDisconnect?.error),
        paired: Boolean(connection.auth.state.creds.me),
        attempt: connection.attempt,
      });
      this.log.info({ channelId, decision }, "[whatsapp] conexão fechada");

      if (decision.kind === "reconnect") {
        connection.attempt += 1;
        if (decision.delayMs > 0) await this.setStatus(tenantId, channelId, "CONNECTING", REASONS.reconnecting);
        connection.timer = setTimeout(() => {
          this.openSocket(connection).catch((err: unknown) =>
            this.log.error({ channelId, err }, "[whatsapp] falha ao reabrir socket"),
          );
        }, decision.delayMs);
        return;
      }

      await this.deps.redis.del(redisKeys.qr(channelId));
      if (decision.kind === "logged-out") {
        await connection.auth.clear();
        await this.setStatus(tenantId, channelId, "LOGGED_OUT", decision.reason);
      } else {
        // QR expirado: descarta a sessão incompleta.
        if (decision.status === "DISCONNECTED") await connection.auth.clear();
        await this.setStatus(tenantId, channelId, decision.status, decision.reason);
      }
      await this.shutdown(connection, { releaseLock: true });
    }
  }

  private async setStatus(tenantId: string, channelId: string, status: ChannelStatus, reason: string | null) {
    await forTenant(tenantId, this.deps.prisma).channel.updateMany({
      where: { id: channelId },
      data: { status, statusReason: reason },
    });
  }

  /** Fecha o socket deste worker (sem logout no WhatsApp). */
  private async shutdown(connection: Connection, options: { releaseLock: boolean }) {
    connection.stopped = true;
    connection.open = false;
    if (connection.timer) clearTimeout(connection.timer);
    connection.sock?.ev.removeAllListeners("connection.update");
    await connection.sock?.end(undefined).catch(() => undefined);
    if (this.connections.get(connection.channelId) === connection) this.connections.delete(connection.channelId);
    if (options.releaseLock) await this.deps.locks.release(connection.channelId);
  }

  private async renewLocks() {
    for (const connection of this.connections.values()) {
      const ok = await this.deps.locks.renew(connection.channelId).catch(() => false);
      if (!ok) {
        this.log.warn({ channelId: connection.channelId }, "[whatsapp] trava perdida; fechando socket");
        await this.shutdown(connection, { releaseLock: false });
      }
    }
  }

  /** Remove o número: logout (se conectado), apaga sessão e chaves, libera trava, apaga o canal. */
  async remove(tenantId: string, channelId: string): Promise<{ loggedOut: boolean }> {
    const connection = this.connections.get(channelId);
    let loggedOut = false;
    if (connection) {
      connection.stopped = true;
      if (connection.open && connection.sock) {
        try {
          await connection.sock.logout("Removido pelo painel");
          loggedOut = true;
        } catch (err) {
          this.log.warn({ channelId, err }, "[whatsapp] logout falhou; removendo mesmo assim");
        }
      }
      await this.shutdown(connection, { releaseLock: false });
    }

    const db = forTenant(tenantId, this.deps.prisma);
    await db.$transaction([
      db.whatsAppSessionKey.deleteMany({ where: { channelId } }),
      db.whatsAppSession.deleteMany({ where: { channelId } }),
      // Cliques ficam (contam para o cliente e a oferta); só perdem o vínculo com post e grupo,
      // que somem junto com o número.
      db.click.updateMany({
        where: { OR: [{ group: { channelId } }, { post: { group: { channelId } } }] },
        data: { groupId: null, postId: null },
      }),
      db.channel.deleteMany({ where: { id: channelId } }),
    ]);
    await this.deps.redis.del(redisKeys.qr(channelId), redisKeys.testSends(channelId));
    await this.deps.locks.release(channelId);
    return { loggedOut };
  }

  /** Relê os grupos do número no WhatsApp. */
  async syncGroups(tenantId: string, channelId: string) {
    const connection = this.connections.get(channelId);
    if (!connection?.open || !connection.sock) throw new SendError("O número não está conectado.");
    const all = await connection.sock.groupFetchAllParticipating();
    const now = Date.now();
    for (const meta of Object.values(all)) connection.groupCache.set(meta.id, { meta, at: now });
    return syncGroups(
      forTenant(tenantId, this.deps.prisma),
      tenantId,
      channelId,
      Object.values(all),
      selfIdsFrom(connection.sock.user),
    );
  }

  /** Socket aberto do número neste worker (fila do piloto automático). */
  getSender(channelId: string): WhatsAppSender | undefined {
    return this.senderFor(channelId);
  }

  private senderFor(channelId: string): WhatsAppSender | undefined {
    const connection = this.connections.get(channelId);
    const sock = connection?.open ? connection.sock : undefined;
    if (!connection || !sock) return undefined;
    return {
      sendMessage: async (jid, content) => {
        const message = await sock.sendMessage(jid, content);
        if (message?.key.id && message.message) {
          connection.sent.set(message.key.id, message.message);
          if (connection.sent.size > SENT_CACHE_SIZE) {
            const oldest = connection.sent.keys().next().value;
            if (oldest) connection.sent.delete(oldest);
          }
        }
        return message;
      },
    };
  }

  /** Envia imagem + texto para um grupo do tenant. */
  sendOfferToWhatsApp(
    tenantId: string,
    groupId: string,
    image: Buffer | string | null | undefined,
    text: string,
  ): Promise<SendResult> {
    return sendOfferToWhatsApp(
      { db: forTenant(tenantId, this.deps.prisma), getSocket: (id) => this.senderFor(id) },
      groupId,
      image,
      text,
    );
  }

  /** Desligamento do worker: fecha sockets sem logout (a sessão continua salva). */
  async stopAll(): Promise<void> {
    if (this.renewTimer) clearInterval(this.renewTimer);
    await Promise.all([...this.connections.values()].map((c) => this.shutdown(c, { releaseLock: true })));
  }
}
