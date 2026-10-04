# CLAUDE.md — Achadinhos Bot

## Produto

SaaS multi-tenant de "achadinhos": coleta ofertas, gerencia no painel web e dispara para grupos/canais de WhatsApp (Baileys) e Telegram (grammY). Envio assíncrono via filas BullMQ (Redis).

Status atual: **fase 1** (contas, login com sessões próprias, multi-tenant, painel base, credenciais de lojas criptografadas).

Planos: Iniciante (`starter`, R$ 79,90), Pro (`pro`, R$ 149,90), Agência (`agency`, R$ 297,00) — definidos em `packages/db/src/plans.ts`. Cadastro = trial de 7 dias no Iniciante; trial vencido vira `PAST_DUE` (pausa de envios: fase 9).

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
apps/web/app/(auth)/   login, cadastro, esqueci-senha, redefinir-senha
apps/web/app/painel/   layout com menu + Início, Canais, Ofertas, Agendamento, Relatórios, Configurações
apps/web/lib/auth/     sessões (session.ts), contas (accounts.ts), server actions, integração Next (current.ts)
apps/web/proxy.ts      redirect /painel sem cookie (middleware do Next 16)
apps/web/test/         testes de auth (Vitest + PGlite)
apps/worker/src/       index.ts, env.ts, queues/, whatsapp/, telegram/
packages/db/prisma/    schema.prisma, migrations/, seed.ts
packages/db/src/       client.ts (getPrisma), tenant.ts (forTenant), crypto.ts, store-credentials.ts,
                       subscription.ts, plans.ts, testing.ts (banco PGlite p/ testes), generated/ (gitignored)
packages/db/test/      isolamento entre tenants, criptografia, trial
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
pnpm test            # Vitest (db + web), banco PGlite em memória, sem rede
pnpm db:generate     # prisma generate
pnpm db:migrate      # prisma migrate dev (cria migration nova)
pnpm db:deploy       # prisma migrate deploy (aplica pendentes)
pnpm db:seed         # planos (idempotente)
cd apps/web && pnpm dlx shadcn@latest add <componente>   # novo componente shadcn/ui
```

## Convenções

- TypeScript estrito; sem `any`. Validar toda entrada externa (env, request, payload de fila, webhook) com zod.
- UI e mensagens ao usuário em **pt-BR**. Código (nomes de variáveis/funções) em inglês.
- Multi-tenant: **todo acesso a dados de tenant passa por `forTenant(tenantId)`** (no web: `getTenantDb()` de `lib/auth/current.ts`). Ele injeta `tenantId` em where/data e lança `TenantScopeError` se o código tentar outro tenant.
  - Em create/update use FKs escalares (`offerId`, `groupId`), nunca `connect`/`tenant`.
  - `$queryRaw`/`$executeRaw` não são filtrados: não usar com dados de tenant.
  - `getPrisma()` cru só para operações de sistema: login, cadastro, sessão, seed, jobs globais.
  - Relações entre models com tenant usam FK composta `(id, tenantId)`; model novo com tenant segue o mesmo padrão, entra em `TENANT_SCOPED_MODELS` e ganha caso no teste de isolamento.
  - Relação opcional com FK composta usa `onDelete: NoAction` (SetNull anularia o tenantId). Oferta/post com cliques: arquivar, não deletar.
- Credenciais de lojas: só via `saveStoreCredential`/`getStoreCredentialSecrets` (AES-256-GCM, AAD = `tenantId:store`, chave `STORE_CREDENTIALS_KEY`). Nunca logar nem mandar segredo descriptografado para o cliente.
- Auth: sessões próprias (padrão Lucia). Cookie `achadinhos_session` com token aleatório; banco guarda só SHA-256. Senha argon2id. Lógica pura recebe `PrismaClient` por parâmetro (testável); cookies/redirect só em `current.ts` e actions.
- Testes de banco: `createTestDatabase()` de `@achadinhos/db/testing` (PGlite em processo, aplica as migrations reais).
- Imports sem extensão (moduleResolution `Bundler`).

## Regras

- **Nunca commitar segredos** (`.env`, tokens, sessão do Baileys em `apps/worker/auth_sessions/`).
- **Nunca usar Docker** — nem Dockerfile, nem docker-compose. Dev roda direto no Windows; deploy no Railway (Railpack/Nixpacks).
- Migration é sempre revisada (SQL mostrado ao usuário) antes do commit. Nunca editar migration já aplicada; criar nova.
- Commits em pt-BR, prefixados pela fase quando aplicável (ex.: `fase 1: ...`).
