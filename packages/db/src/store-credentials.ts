import { z } from "zod";
import { decrypt, encrypt, parseEncryptionKey } from "./crypto";
import type { PrismaClient } from "./generated/prisma/client";
import type { Store } from "./generated/prisma/enums";
import { forTenant } from "./tenant";

export const CURRENT_KEY_VERSION = 1;

const secretsSchema = z.record(z.string(), z.string());
export type StoreSecrets = z.infer<typeof secretsSchema>;

interface Options {
  client?: PrismaClient;
  key?: Buffer;
}

export function getStoreCredentialsKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.STORE_CREDENTIALS_KEY;
  if (!raw) throw new Error("STORE_CREDENTIALS_KEY não definida no .env.");
  return parseEncryptionKey(raw);
}

function aadFor(tenantId: string, store: Store): string {
  return `${tenantId}:${store}`;
}

export function maskSecret(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

/**
 * Cria ou substitui a credencial da loja, criptografada. `verifiedAt` marca
 * "Sincronizado"; salvar dados novos sem verificação volta para não sincronizado.
 */
export async function saveStoreCredential(
  tenantId: string,
  input: { store: Store; label?: string | null; secrets: StoreSecrets; verifiedAt?: Date | null },
  options: Options = {},
) {
  const db = forTenant(tenantId, options.client);
  const key = options.key ?? getStoreCredentialsKey();
  const secrets = secretsSchema.parse(input.secrets);
  const encrypted = encrypt(JSON.stringify(secrets), key, aadFor(tenantId, input.store));
  const label = input.label ?? null;
  // Salvar de novo tira a loja da pausa do piloto automático (credencial corrigida).
  const status = { verifiedAt: input.verifiedAt ?? null, lastError: null, autopilotPausedAt: null };

  return db.storeCredential.upsert({
    where: { tenantId_store: { tenantId, store: input.store } },
    create: { tenantId, store: input.store, label, keyVersion: CURRENT_KEY_VERSION, ...status, ...encrypted },
    update: { label, keyVersion: CURRENT_KEY_VERSION, ...status, ...encrypted },
    select: { id: true, store: true, label: true, updatedAt: true, verifiedAt: true },
  });
}

/** Resultado do botão "Testar": sincronizado (ok) ou motivo da falha. */
export async function setStoreCredentialStatus(
  tenantId: string,
  store: Store,
  status: { ok: true; at?: Date } | { ok: false; error: string },
  options: Options = {},
) {
  const db = forTenant(tenantId, options.client);
  const data = status.ok
    ? { verifiedAt: status.at ?? new Date(), lastError: null }
    : { verifiedAt: null, lastError: status.error.slice(0, 500) };
  const { count } = await db.storeCredential.updateMany({ where: { store }, data });
  return count > 0;
}

/** Segredos descriptografados (uso interno: integrações com a loja). */
export async function getStoreCredentialSecrets(
  tenantId: string,
  store: Store,
  options: Options = {},
): Promise<StoreSecrets | null> {
  const db = forTenant(tenantId, options.client);
  const row = await db.storeCredential.findUnique({ where: { tenantId_store: { tenantId, store } } });
  if (!row) return null;
  if (row.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`Versão de chave ${row.keyVersion} não suportada.`);
  }
  const key = options.key ?? getStoreCredentialsKey();
  const plaintext = decrypt(row, key, aadFor(tenantId, store));
  return secretsSchema.parse(JSON.parse(plaintext));
}

/** Lista para a UI: só nomes dos campos e valores mascarados. */
export async function listStoreCredentials(tenantId: string, options: Options = {}) {
  const db = forTenant(tenantId, options.client);
  const key = options.key ?? getStoreCredentialsKey();
  const rows = await db.storeCredential.findMany({ orderBy: { store: "asc" } });
  return rows.map((row) => {
    const secrets = secretsSchema.parse(JSON.parse(decrypt(row, key, aadFor(tenantId, row.store))));
    return {
      id: row.id,
      store: row.store,
      label: row.label,
      updatedAt: row.updatedAt,
      verifiedAt: row.verifiedAt,
      lastError: row.lastError,
      fields: Object.entries(secrets).map(([name, value]) => ({ name, masked: maskSecret(value) })),
    };
  });
}

export async function deleteStoreCredential(tenantId: string, store: Store, options: Options = {}) {
  const db = forTenant(tenantId, options.client);
  const { count } = await db.storeCredential.deleteMany({ where: { store } });
  return count > 0;
}
