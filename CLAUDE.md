# CLAUDE.md — Achadinhos Bot

## Produto

SaaS multi-tenant de "achadinhos": coleta ofertas, gerencia no painel web e dispara para grupos/canais de WhatsApp (Baileys) e Telegram (grammY). Envio assíncrono via filas BullMQ (Redis).

Status atual: **fase 0** (esqueleto). Fase 1: models Prisma (Tenant, Offer, ...) + primeira migration.

## Stack

- Node.js 24 LTS (fixado em `.nvmrc` e `engines`), pnpm 9 workspaces
- TypeScript 6 estrito (`tsconfig.base.json` na raiz)
- `apps/web`: Next.js 16 App Router, Tailwind CSS 4, shadcn/ui (style base-nova)
- `apps/worker`: Node + tsx, BullMQ, ioredis, Baileys 7, grammY
- `packages/db` (`@achadinhos/db`): Prisma 7 (generator `prisma-client`, adapter `@prisma/adapter-pg`), PostgreSQL
- Validação: zod 4
- Infra: Railway (Postgres + Redis). Dev local usa os serviços do Railway pelas URLs públicas.

## Estrutura

```
apps/web/              Next.js (app/, components/ui/, lib/)
apps/worker/src/       index.ts, env.ts, queues/, whatsapp/, telegram/
packages/db/prisma/    schema.prisma, migrations/
packages/db/src/       index.ts (getPrisma singleton), generated/ (gitignored)
```

- Pacotes internos exportam TypeScript direto (`exports: ./src/index.ts`). Web usa `transpilePackages`; worker roda via `tsx` (dev e produção).
- `.env` único na raiz. Web carrega via `next.config.ts`, worker via `--env-file-if-exists`, Prisma via `prisma.config.ts`.
- URL do banco no Prisma 7 fica em `packages/db/prisma.config.ts`, não no schema.

## Comandos

```
pnpm install         # instala tudo + prisma generate
pnpm dev             # web (localhost:3000) + worker em paralelo
pnpm build           # build de todos os pacotes
pnpm typecheck       # tsc em todos os pacotes
pnpm test            # testes (quando existirem)
pnpm db:generate     # prisma generate
pnpm db:migrate      # prisma migrate dev (fase 1+)
cd apps/web && pnpm dlx shadcn@latest add <componente>   # novo componente shadcn/ui
```

## Convenções

- TypeScript estrito; sem `any`. Validar toda entrada externa (env, request, payload de fila, webhook) com zod.
- UI e mensagens ao usuário em **pt-BR**. Código (nomes de variáveis/funções) em inglês.
- Multi-tenant: **toda query Prisma filtra por `tenantId`**. Nunca buscar/alterar dados sem escopo de tenant.
- Prisma só via `getPrisma()` de `@achadinhos/db`.
- Imports sem extensão (moduleResolution `Bundler`).

## Regras

- **Nunca commitar segredos** (`.env`, tokens, sessão do Baileys em `apps/worker/auth_sessions/`).
- **Nunca usar Docker** — nem Dockerfile, nem docker-compose. Dev roda direto no Windows; deploy no Railway (Railpack/Nixpacks).
- Não rodar `prisma migrate` sem models novos; migration é sempre revisada antes do commit.
- Commits em pt-BR, prefixados pela fase quando aplicável (ex.: `fase 1: ...`).
