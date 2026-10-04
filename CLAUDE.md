# CLAUDE.md — Achadinhos Bot

## Produto

SaaS multi-tenant de "achadinhos": coleta ofertas, gerencia no painel web e dispara para grupos/canais de WhatsApp (Baileys) e Telegram (grammY). Envio assíncrono via filas BullMQ (Redis).

Status atual: **fase 2** (WhatsApp via Baileys: conexão por QR, sessão no Postgres, reconexão, grupos, envio de teste). Fase 1: contas, login, multi-tenant, painel base, credenciais de lojas criptografadas.

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
apps/web/app/painel/canais/   lista de números (QR, status), whatsapp/[channelId] (grupos, envio de teste), actions.ts
apps/web/lib/queue.ts  painel -> worker (BullMQ "whatsapp", leitura do QR no Redis)
apps/worker/src/       index.ts, env.ts, redis.ts, queues/whatsapp.ts (jobs), telegram/
apps/worker/src/whatsapp/  auth-state.ts (sessão no Postgres), manager.ts (sockets), reconnect.ts (decisão pura),
                       lock.ts (trava Redis), groups.ts, send.ts (sendOfferToWhatsApp), image.ts, rate-limit.ts
apps/worker/test/      auth state, reconexão, limites, imagem, grupos/envio (Vitest + PGlite)
packages/jobs/         @achadinhos/jobs: nome da fila, schemas zod dos jobs, chaves Redis (contrato web <-> worker)
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
pnpm test            # Vitest (db + web + worker), banco PGlite em memória, sem rede
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
- Limites do plano: `assertCanAddWhatsappNumber`, `assertChannelWithinWhatsappLimit`, `assertCanEnableGroupPosting` (`packages/db/src/limits.ts`). Checar no painel E no worker.

## WhatsApp (Baileys)

- **Baileys fixado em versão exata (`7.0.0-rc14`, sem ^/~). Só atualizar depois de testar a versão nova** (conectar por QR, reconectar, listar grupos, enviar teste) num número de teste.
- Sessão SÓ no Postgres: `WhatsAppSession` (creds) + `WhatsAppSessionKey` (chaves Signal, 1 linha por chave), AES-256-GCM com `WHATSAPP_SESSION_KEY`, AAD `wa:<channelId>:<tipo>:<id>`. Nunca `useMultiFileAuthState` nem arquivo em disco (Railway apaga a cada deploy).
- Painel -> worker só pela fila `whatsapp` (`@achadinhos/jobs`). Worker -> painel: status no banco (`Channel.status/statusReason`) e QR no Redis (`wa:qr:<channelId>`, 60s). Painel consulta `/api/whatsapp/channels/[id]`.
- Todo job revalida no worker que o canal é do `tenantId` do job.
- Um número = um socket em um único worker: trava `wa:lock:<channelId>` no Redis. Dev e produção usam projetos Railway separados (bancos e Redis diferentes).
- Reconexão: decisão em `reconnect.ts` (515 reconecta já; 401/411 = LOGGED_OUT e apaga sessão; 440/403 = ERROR e para; QR expirado = DISCONNECTED; resto = backoff 2s→5min).
- Envio de teste: máx. 10/número/hora e 20s entre envios (`rate-limit.ts`). Imagem por URL: só https, 10s, 5 MB, jpeg/png/webp, bloqueia IP interno; falhou = envia só texto com aviso.
- Envio em massa ainda NÃO existe. Não adicionar sem limite por número e pausa entre mensagens (risco de banimento).
- Imports sem extensão (moduleResolution `Bundler`).

## Regras

- **Nunca commitar segredos** (`.env`, tokens, chaves de criptografia, dados de sessão do WhatsApp).
- **Nunca usar Docker** — nem Dockerfile, nem docker-compose. Dev roda direto no Windows; deploy no Railway (Railpack/Nixpacks).
- Migration é sempre revisada (SQL mostrado ao usuário) antes do commit. Nunca editar migration já aplicada; criar nova.
- Commits em pt-BR, prefixados pela fase quando aplicável (ex.: `fase 1: ...`).
