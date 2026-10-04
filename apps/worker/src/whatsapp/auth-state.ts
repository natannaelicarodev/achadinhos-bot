// Auth state do Baileys guardado no PostgreSQL (criptografado). Substitui o
// useMultiFileAuthState: nada em disco, porque o Railway apaga arquivos a cada deploy.
import { decrypt, encrypt, forTenant, type EncryptedPayload, type PrismaClient } from "@achadinhos/db";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "baileys";

const KEY_VERSION = 1;
// Limites por comando SQL (o Postgres aceita até 65.535 parâmetros; cada linha usa 9).
const INSERT_BATCH = 500;
const DELETE_BATCH = 1000;
const TX_TIMEOUT_MS = 30_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PostgresAuthStateOptions {
  tenantId: string;
  channelId: string;
  /** WHATSAPP_SESSION_KEY (32 bytes). */
  key: Buffer;
  client?: PrismaClient;
}

export async function usePostgresAuthState({ tenantId, channelId, key, client }: PostgresAuthStateOptions) {
  const db = forTenant(tenantId, client);

  // AAD amarra cada valor ao número, tipo e id: copiado para outro lugar, não abre.
  const aad = (type: string, id: string) => `wa:${channelId}:${type}:${id}`;
  const seal = (value: unknown, type: string, id: string) =>
    encrypt(JSON.stringify(value, BufferJSON.replacer), key, aad(type, id));
  const open = (row: EncryptedPayload & { keyVersion: number }, type: string, id: string): unknown => {
    if (row.keyVersion !== KEY_VERSION) throw new Error(`Versão de chave ${row.keyVersion} não suportada.`);
    return JSON.parse(decrypt(row, key, aad(type, id)), BufferJSON.reviver);
  };

  const sessionRow = await db.whatsAppSession.findUnique({ where: { channelId } });
  const creds: AuthenticationCreds = sessionRow
    ? (open(sessionRow, "creds", "creds") as AuthenticationCreds)
    : initAuthCreds();

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      if (ids.length === 0) return result;
      const rows = await db.whatsAppSessionKey.findMany({ where: { channelId, type, keyId: { in: ids } } });
      for (const row of rows) {
        let value = open(row, type, row.keyId);
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
        }
        result[row.keyId] = value as SignalDataTypeMap[T];
      }
      return result;
    },

    // Grava em lote, numa única transação (tudo ou nada), antes de resolver
    // (exigência do Baileys). Por tipo: apaga as chaves citadas e insere as
    // que têm valor; null/undefined só apaga. Poucas consultas em vez de uma
    // por chave (a 1ª conexão grava 812 pre-keys de uma vez).
    async set(data: SignalDataSet) {
      const operations = [];
      for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const entries = data[type];
        if (!entries) continue;
        const keyIds = Object.keys(entries);
        if (keyIds.length === 0) continue;

        const rows = [];
        for (const [keyId, value] of Object.entries(entries)) {
          if (value === null || value === undefined) continue;
          rows.push({ tenantId, channelId, type, keyId, keyVersion: KEY_VERSION, ...seal(value, type, keyId) });
        }
        for (const ids of chunk(keyIds, DELETE_BATCH)) {
          operations.push(db.whatsAppSessionKey.deleteMany({ where: { channelId, type, keyId: { in: ids } } }));
        }
        for (const batch of chunk(rows, INSERT_BATCH)) {
          operations.push(db.whatsAppSessionKey.createMany({ data: batch }));
        }
      }
      // Limite folgado: o padrão do Prisma (5s) é pouco com o banco remoto do dev.
      if (operations.length > 0) await db.$transaction(operations, { timeout: TX_TIMEOUT_MS, maxWait: TX_TIMEOUT_MS });
    },

    async clear() {
      await db.whatsAppSessionKey.deleteMany({ where: { channelId } });
    },
  };

  // O Baileys altera `creds` no próprio objeto; gravações em fila, uma por vez.
  let credsQueue: Promise<void> = Promise.resolve();
  const saveCreds = (): Promise<void> => {
    credsQueue = credsQueue
      .catch(() => undefined)
      .then(async () => {
        const sealed = seal(creds, "creds", "creds");
        await db.whatsAppSession.upsert({
          where: { channelId },
          create: { tenantId, channelId, keyVersion: KEY_VERSION, ...sealed },
          update: { keyVersion: KEY_VERSION, ...sealed },
        });
      });
    return credsQueue;
  };

  /** Apaga sessão e chaves (logout / remoção do número). */
  const clear = async (): Promise<void> => {
    await credsQueue.catch(() => undefined);
    await db.$transaction([
      db.whatsAppSessionKey.deleteMany({ where: { channelId } }),
      db.whatsAppSession.deleteMany({ where: { channelId } }),
    ]);
  };

  return { state: { creds, keys }, saveCreds, clear, hadSession: sessionRow !== null };
}

export type PostgresAuthState = Awaited<ReturnType<typeof usePostgresAuthState>>;
