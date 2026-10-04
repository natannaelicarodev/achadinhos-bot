import type { PrismaClient } from "./generated/prisma/client";
import { getPrisma } from "./client";

/** Models com coluna `tenantId`: toda operação recebe o filtro/valor do tenant. */
export const TENANT_SCOPED_MODELS = [
  "User",
  "Subscription",
  "Channel",
  "Group",
  "Offer",
  "Post",
  "Click",
  "Conversion",
  "StoreCredential",
] as const;

const scopedModels = new Set<string>(TENANT_SCOPED_MODELS);

/** Models globais que o client de tenant pode só ler. */
const readOnlyGlobalModels = new Set<string>(["Plan"]);

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const WHERE_OPERATIONS = new Set([
  ...READ_OPERATIONS,
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_DATA_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);

export class TenantScopeError extends Error {
  override name = "TenantScopeError";
}

type Args = Record<string, unknown>;

function asRecord(value: unknown): Args {
  return value && typeof value === "object" ? (value as Args) : {};
}

function scopeWhere(where: unknown, tenantId: string): Args {
  const w = asRecord(where);
  if ("tenantId" in w && w.tenantId !== tenantId) {
    throw new TenantScopeError("Filtro com tenantId de outro tenant.");
  }
  return { ...w, tenantId };
}

function scopeCreateData(data: unknown, tenantId: string): Args {
  const d = asRecord(data);
  if ("tenant" in d) {
    throw new TenantScopeError("Use o campo tenantId (escalar), não a relação tenant.");
  }
  if (d.tenantId !== undefined && d.tenantId !== tenantId) {
    throw new TenantScopeError("Tentativa de criar registro em outro tenant.");
  }
  return { ...d, tenantId };
}

function checkUpdateData(data: unknown, tenantId: string): Args {
  const d = asRecord(data);
  if ("tenant" in d || (d.tenantId !== undefined && d.tenantId !== tenantId)) {
    throw new TenantScopeError("Não é permitido mover registro para outro tenant.");
  }
  return d;
}

function scopeTenantModel(operation: string, args: Args, tenantId: string): Args {
  // O próprio Tenant: só leitura/atualização do registro do tenant atual.
  if (!READ_OPERATIONS.has(operation) && operation !== "update") {
    throw new TenantScopeError(`Operação ${operation} em Tenant não é permitida pelo client de tenant.`);
  }
  const where = asRecord(args.where);
  if ("id" in where && where.id !== tenantId) {
    throw new TenantScopeError("Acesso a outro tenant.");
  }
  return { ...args, where: { ...where, id: tenantId } };
}

/**
 * Client Prisma restrito a um tenant. Toda leitura/escrita em model com
 * `tenantId` recebe o filtro do tenant; criar ou mover registro para outro
 * tenant lança `TenantScopeError`.
 *
 * Regras de uso:
 * - Em create/update, use FKs escalares (`offerId`, `groupId`), não `connect`.
 * - `$queryRaw`/`$executeRaw` NÃO são filtrados: não use com este client.
 */
export function forTenant(tenantId: string, client: PrismaClient = getPrisma()) {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new TenantScopeError("tenantId obrigatório.");
  }

  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a: Args = { ...asRecord(args) };

          if (model === "Tenant") {
            return query(scopeTenantModel(operation, a, tenantId) as typeof args);
          }
          if (readOnlyGlobalModels.has(model)) {
            if (!READ_OPERATIONS.has(operation)) {
              throw new TenantScopeError(`${model} é somente leitura no client de tenant.`);
            }
            return query(args);
          }
          if (!scopedModels.has(model)) {
            throw new TenantScopeError(`${model} não pode ser acessado pelo client de tenant.`);
          }

          if (WHERE_OPERATIONS.has(operation)) {
            a.where = scopeWhere(a.where, tenantId);
          }
          if (CREATE_OPERATIONS.has(operation)) {
            a.data = Array.isArray(a.data)
              ? a.data.map((item) => scopeCreateData(item, tenantId))
              : scopeCreateData(a.data, tenantId);
          }
          if (UPDATE_DATA_OPERATIONS.has(operation)) {
            a.data = checkUpdateData(a.data, tenantId);
          }
          if (operation === "upsert") {
            a.create = scopeCreateData(a.create, tenantId);
            a.update = checkUpdateData(a.update, tenantId);
          }

          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
