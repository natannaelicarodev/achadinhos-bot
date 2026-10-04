# CLAUDE.md — Achadinhos Bot

## Produto

SaaS multi-tenant de "achadinhos": coleta ofertas, gerencia no painel web e dispara para grupos de WhatsApp (Baileys). Envio assíncrono via filas BullMQ (Redis).

**Lançamento só com WhatsApp. Telegram está FORA do escopo atual** (decisão de produto): não implementar nada de Telegram (bot, envio, tela, job, integração grammY) sem o dono do produto pedir. O que já existe fica como está e não deve ser removido: `Plan.maxTelegramBots`, `ChannelType.TELEGRAM`, a dependência `grammy` e o stub `apps/worker/src/telegram/`. No painel, a aba Telegram de Canais só registra interesse ("Quero usar o Telegram" -> `FeatureRequest`).

Status atual: **fase 4b** (credenciais de afiliado do cliente, conversão de links, Divulgar link, mensagem pronta). Fase 4a: catálogo central minerado nas lojas + página Catálogo. Fase 3: Telegram adiado + pedido de interesse. Fase 2: WhatsApp via Baileys (conexão por QR, sessão no Postgres, reconexão, grupos, envio de teste). Fase 1: contas, login, multi-tenant, painel base, credenciais de lojas criptografadas.

Planos: Iniciante (`starter`, R$ 79,90), Pro (`pro`, R$ 149,90), Agência (`agency`, R$ 297,00) — definidos em `packages/db/src/plans.ts`. Cadastro = trial de 7 dias no Iniciante; trial vencido vira `PAST_DUE` (pausa de envios: fase 9).

## Stack

- Node.js 24 LTS (fixado em `.nvmrc` e `engines`), pnpm 9 workspaces
- TypeScript 6 estrito (`tsconfig.base.json` na raiz)
- `apps/web`: Next.js 16 App Router, Tailwind CSS 4, shadcn/ui (style base-nova)
- `apps/worker`: Node + tsx, BullMQ, ioredis, Baileys 7 (grammY instalado mas sem uso: Telegram adiado)
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
packages/db/src/catalog.ts       gravação da mineração (lote), ranking, listCatalog, favoritos
packages/db/src/offers.ts        saveOfferForSending ("Enviar para meus grupos")
packages/stores/                 @achadinhos/stores: Shopee (reader central / link do cliente), urls, credenciais, links, mensagem
apps/web/app/painel/credenciais/ página Configurar credenciais (cards por loja)
apps/web/app/painel/divulgar-link/ colar link -> converter -> mensagem; actions de prévia e envio (também usadas no catálogo)
apps/web/components/divulgar/    SharePanel (link + prévia WhatsApp + copiar/enviar), TemplateEditor
apps/worker/src/catalog/         types.ts (CatalogMiner), shopee.ts, amazon.ts, run.ts; queues/catalog.ts (agendamento)
apps/web/app/painel/catalogo/    página Catálogo (cards, busca, categorias, lojas, favoritos, modal)
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
pnpm test            # Vitest (db + stores + web + worker), banco PGlite em memória, sem rede
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
- Pedidos de interesse em recursos futuros: tabela `FeatureRequest` (`tenantId`, `userId`, `feature`, `createdAt`), um voto por tenant e recurso (`@@unique([tenantId, feature])`). Usar `requestFeature`/`getFeatureRequest` (`packages/db/src/feature-requests.ts`); recurso novo = novo código em `FEATURE_CODES` (sem migration). Hoje: `"telegram"`.
- Limites do plano: `assertCanAddWhatsappNumber`, `assertChannelWithinWhatsappLimit`, `assertCanEnableGroupPosting` (`packages/db/src/limits.ts`). Checar no painel E no worker.

## Catálogo central e ofertas

- **Catálogo central** (`CatalogProduct`, SEM tenantId): igual para todos os clientes, minerado pelo worker (`apps/worker/src/catalog/`, fila `catalog`, a cada `CATALOG_MINING_INTERVAL_MINUTES`, padrão 60). Tenant só LÊ o catálogo (`forTenant` bloqueia escrita); `Favorite` é por tenant.
- Interface `CatalogMiner` (status/mine/verify) por loja. Cada execução gera `CatalogMiningRun` (SUCCESS / FAILED / SKIPPED com motivo).
- **Credenciais centrais do sistema** (`SHOPEE_CATALOG_*`, `AMAZON_CATALOG_*`) servem SÓ para LER produtos: mineração (worker) e prévia de título/preço/imagem da Shopee no "Divulgar link" (painel, `getCentralShopeeReader`). NUNCA para gerar link. Garantido por tipo: credencial central só entra em `ShopeeCatalogReader` (sem operação de link); `ShopeeLinkGenerator`/`generateAffiliateLink` só recebem a credencial DO CLIENTE (StoreCredential). Teste em `packages/stores/test/shopee.test.ts` ("REGRA: credencial central só lê"). O catálogo guarda só link limpo da loja (`stripAffiliateParams`; a consulta da Shopee nem pede `offerLink`).
- Ranking: `computeCatalogScore` (vendas 45%, nota 25%, desconto 15%, comissão 15%). Nota informada abaixo de 4,5 não entra / sai do catálogo. Produto parado há 24h é reconferido pelo id; se a loja não devolver mais, `active=false` (erro de rede não desativa).
- **Shopee:** Open API de afiliados (GraphQL, assinatura SHA256(AppId+Timestamp+Payload+Secret)), busca por palavras-chave de cada categoria (mais vendidos e maior comissão) + "top performing".
- **Amazon:** Creators API. Token OAuth e `getItems` implementados (documentados). O caminho HTTP do `searchItems` NÃO está na documentação oficial: minerador desligado (SKIPPED) até confirmar. Não inventar endpoint. A API não devolve nota, vendidos nem comissão (exige 10 vendas/30 dias na conta).
- **Mercado Livre fica FORA do catálogo** (busca pública da API responde 403; "mais vendidos" exige OAuth; sem raspagem). Entra pela tela **"Divulgar link"** (`/painel/divulgar-link`, junto com Shein, Shopee e Amazon): o cliente cola o endereço do produto e o sistema converte com a etiqueta DELE. No catálogo, o filtro Mercado Livre é um atalho para essa tela.

## Links de afiliado do cliente (fase 4b)

- Código das lojas em `packages/stores` (`@achadinhos/stores`), usado por painel e worker. `@achadinhos/stores/message` é o único caminho importável no navegador (o resto usa crypto/banco).
- Credenciais do cliente: página `/painel/credenciais`, salvas cifradas em `StoreCredential` (formatos em `packages/stores/src/credentials.ts`). "Sincronizado" = `verifiedAt` preenchido: Shopee após teste real (`ShopeeLinkGenerator.test()` gera um link); demais lojas após validação do formato. Só o OWNER altera.
- `generateAffiliateLink(tenantId, produto)`:
  - Shopee: `generateShortLink` com a credencial do cliente; `subIds` = [tenant] no painel, [tenant, grupo] no envio (fase 5). subIds só letras/números, até 50.
  - Amazon: `https://www.amazon.com.br/dp/{ASIN}?tag={tag do cliente}`.
  - Mercado Livre: URL do produto + `matt_word` e `matt_tool` do cliente (sem extensão de navegador). Etiqueta de outro afiliado é TROCADA, nunca somada.
  - **Mercado Livre, meli.la do portal:** o link oficial leva a uma página `/social/{perfil}?matt_word&matt_tool&forceInApp&ref={token ~200 chars}` que mostra o produto "recomendado por" o afiliado. O `ref` é gerado pelo portal do ML (sem API pública): NÃO tentar gerar. Se o cliente colar um meli.la DELE (Etiqueta e Ferramenta batem com a credencial), o sistema usa o próprio meli.la como link (confere de novo no servidor ao enviar). meli.la de outra pessoa: acha o produto na página social e converte com as etiquetas do cliente. Endereço comum de produto: converte e avisa para preferir o meli.la. Se o link só com matt_word/matt_tool atribui a venda, confirmar no teste de compra real do README.
  - A página de produto do ML bloqueia leitura automática: no ML o preço costuma ficar para o cliente preencher (título e imagem vêm da página social).
  - Shein: URL br.shein.com + `url_from=affiliate_koc_{ID}` + `campaign_id=20` (`SHEIN_CAMPAIGN_ID`). **O 20 veio de um link real gerado na conta de afiliada da dona do produto** (vale mais que o exemplo público, que usa 10). Confirmar no teste de compra real do README.
  - Sem credencial: `MissingCredentialError` (pt-BR) e botão "Configurar credenciais".
- Redirecionamentos (meli.la, amzn.to, onelink.shein.com, links curtos) e leitura de página só em domínios das lojas (`resolveStoreUrl`, `fetchProductInfo`; lista fechada, 5 saltos, 10s). Nunca buscar URL arbitrária no servidor. Imagem para "Copiar imagem" passa por `/api/image-proxy` (só CDNs das lojas).
- Mensagem: `MessageTemplate` (um por tenant; sem linha = modelo padrão). Variáveis `{headline} {titulo} {preco_de} {preco_por} {desconto} {link}`; linha com variável vazia some. Editor em Configurações.
- "Enviar para meus grupos": o servidor REFAZ o link e a mensagem (não confia no navegador) e grava a `Offer` (`saveOfferForSending`: `affiliateUrl`, `messageText`, `sendRequestedAt`, status ACTIVE). Uma oferta por produto do catálogo por tenant. O envio aos grupos é da fase 5 (ofertas com `sendRequestedAt`).
- **Pendente para a fase 5:** `Post` NÃO guarda cópia do que foi enviado (só shortCode, status, datas, id da mensagem, erro). Antes de enviar posts reais, acrescentar snapshot no `Post` (texto final, preço e link enviados) para o histórico não mudar quando a `Offer` for atualizada.

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
