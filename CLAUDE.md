# CLAUDE.md — Achadinhos Bot

## Produto

SaaS multi-tenant de "achadinhos": coleta ofertas, gerencia no painel web e dispara para grupos de WhatsApp (Baileys). Envio assíncrono via filas BullMQ (Redis).

**Lançamento só com WhatsApp. Telegram está FORA do escopo atual** (decisão de produto): não implementar nada de Telegram (bot, envio, tela, job, integração grammY) sem o dono do produto pedir. O que já existe fica como está e não deve ser removido: `Plan.maxTelegramBots`, `ChannelType.TELEGRAM`, a dependência `grammy` e o stub `apps/worker/src/telegram/`. No painel, a aba Telegram de Canais só registra interesse ("Quero usar o Telegram" -> `FeatureRequest`).

Status atual: **fase 6** (vendas da Shopee por grupo nos Relatórios; link rastreável /o/ pronto e desligado). Fase 5: piloto automático + fila de envio aos grupos. Fase 4e: Amazon (link curto pela SiteStripe na extensão do cliente + "Mais vendidos" no catálogo pela vitrine compartilhada). Fase 4d: Mercado Livre no catálogo central pela vitrine compartilhada da extensão do administrador. Fase 4c: extensão do Chrome (meli.la e preço real do ML automáticos). Fase 4b: credenciais de afiliado do cliente, conversão de links, Divulgar link, mensagem pronta. Fase 4a: catálogo central minerado nas lojas + página Catálogo. Fase 3: Telegram adiado + pedido de interesse. Fase 2: WhatsApp via Baileys (conexão por QR, sessão no Postgres, reconexão, grupos, envio de teste). Fase 1: contas, login, multi-tenant, painel base, credenciais de lojas criptografadas.

Planos (`packages/db/src/plans.ts`; mensal / anual): Catálogo (`catalog`, R$ 19,90 / R$ 197: só catálogo, credenciais, conversão de links, Divulgar link e mensagem para copiar; 0 números/grupos/ofertas), Iniciante (`starter`, R$ 47 / R$ 467: 1 número, 10 grupos, 20 ofertas/dia, 300 legendas IA/mês), Pro (`pro`, R$ 97 / R$ 967: 3 números, 50 grupos, 100 ofertas/dia, IA ilimitada), Agência (`agency`, R$ 197 / R$ 1.967: 10 números, grupos ilimitados, 500 ofertas/dia, 5 usuários, IA ilimitada). `maxPostsPerDay` conta OFERTAS distintas por dia. `aiCaptionsPerMonth` (null = ilimitado) é da fase 7; `annualPriceCents` é da cobrança (fase 9). Plano sem números (`planAllowsSending` false): Canais e Agendamento bloqueados com "Disponível a partir do plano Iniciante", sem "Enviar para meus grupos" (servidor recusa). Mudou plano no código -> `pnpm db:seed` (upsert pelo `code`, não mexe em assinaturas). Cadastro = trial de 7 dias no Iniciante; trial vencido vira `PAST_DUE` (pausa de envios: fase 9).

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
pnpm test            # Vitest (db + stores + extension + web + worker), banco PGlite em memória, sem rede
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
- **Amazon:** o catálogo vem da vitrine compartilhada ("Mais vendidos", ver fase 4e). O minerador da Creators API continua desligado (SKIPPED): o caminho HTTP do `searchItems` NÃO está na documentação oficial; não inventar endpoint (exige 10 vendas/30 dias na conta).
- **Mercado Livre:** entra no catálogo pela vitrine compartilhada (ver seção da fase 4d). Também pela tela **"Divulgar link"** (`/painel/divulgar-link`, junto com Shein, Shopee e Amazon).

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
- "Enviar para meus grupos" grava a `Offer` com `sendRequestedAt`; a fila da fase 5 cria os posts (`sendQueuedAt`) e envia.

## Extensão do Chrome (fase 4c)

- `apps/extension` (`@achadinhos/extension`): Manifest V3, gerada por `pnpm --filter @achadinhos/extension build` (esbuild) em `dist/` + `.zip` em `apps/web/public/downloads/achadinhos-extensao.zip` (ambos no .gitignore; o build/dev do web gera antes). **Distribuição só pelo painel** (página Extensão, instalação "Carregar sem compactação"); NÃO publicar na Chrome Web Store.
- Por que existe: o Mercado Livre não tem API de afiliados. O link meli.la só é gerado pelo portal com a sessão do usuário. A extensão faz o MESMO pedido do botão "Gerar" do portal: `POST https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink` com `{ urls: [produto], tag }` e header `x-csrf-token` (token em `<meta name="csrf-token">` da página `/afiliados/hub`). Resposta: `urls[0].short_url` (meli.la), `long_url` (página social com `ref`). Endpoint INTERNO: pode mudar sem aviso; o painel sempre tem plano B (colar o meli.la).
- Os pedidos ao ML rodam DENTRO de uma aba do ML (`chrome.scripting.executeScript`, `ml-tab.ts`): do service worker o ML recusa (origem chrome-extension). Usa aba do ML aberta; se não houver, abre uma em segundo plano e fecha.
- Permissões mínimas: `scripting`, `storage`, `alarms` + hosts do ML (`mercadolivre.com.br`, `meli.la`), da Amazon (`www.amazon.com.br`) e do painel (envio da vitrine). Content script só nas origens do painel (localhost:3000 + `APP_URL`, injetadas no build). Sessão/cookies do ML NUNCA saem do navegador: o painel recebe só link, título, preço e imagem.
- Protocolo (`apps/extension/src/protocol.ts`): painel -> `window.postMessage({source:"achadinhos-panel", id, type, payload})`; tipos `ping`, `ml.createLink`, `ml.productInfo`, `ml.diagnose`, `ml.hubSearch`, `amz.createLink`, `amz.productInfo`, `amz.diagnose`, `vitrine.configure`/`vitrine.status`/`vitrine.runNow` (só administrador). Validação zod no service worker; a ponte (`content.ts`) só repassa formato válido da própria janela.
- O servidor CONFERE todo meli.la vindo da extensão (`confirmExtensionLinkAction`: etiqueta e ferramenta batem com a credencial do tenant).
- Versão: `EXTENSION_VERSION` (`constants.ts`). Mudou a extensão -> subir a versão; o painel avisa "baixe a nova" (`isOutdated`). Atualização é manual (baixar, substituir arquivos, recarregar ↻).

## Catálogo: Mercado Livre pela vitrine compartilhada (fase 4d)

- A API oficial do ML NÃO serve: testado em 10/2026 com app próprio (client_credentials e token de usuário com PKCE): `/sites/MLB/search`, `/highlights`, `/trends`, `/items`, `/products` respondem 403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (exige app certificado). Não insistir sem certificação.
- **Vitrine compartilhada:** a extensão do ADMINISTRADOR (`SYSTEM_ADMIN_EMAILS`; botão "Ativar nesta extensão" na página Extensão) busca de hora em hora (`chrome.alarms`, Chrome aberto e logado no ML) a vitrine do portal de afiliados: mais vendidos de cada categoria (`ML_CATEGORY_IDS`) + vitrine geral, 10 páginas cada (~14 produtos por página), numa única aba do ML (`holdMlTab`). Envia a `POST /api/catalog/mercado-livre` com `Authorization: Bearer ML_VITRINE_TOKEN`; o servidor valida (zod, só URLs do ML e imagens mlstatic) e grava no catálogo central (`saveMinedProducts`, store MERCADO_LIVRE, `externalId` = id do card) + `CatalogMiningRun`.
- Só dados de produto saem do navegador do administrador (nunca cookie/sessão). Os clientes veem o ML no catálogo SEM extensão e sem credenciais; o LINK continua sendo do cliente (meli.la pela extensão dele, ou etiqueta dele).
- ML não tem "reconferir": `listCatalog` esconde produto do ML com `lastSeenAt` > 48h (`MERCADO_LIVRE_STALE_HOURS`).
- Endpoint da vitrine: `POST https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop`, corpo `{search, sort:"relevance", filters:[{id:"category", value:"MLB..."}, {id:"best_seller", value:true}], offset}`; resposta `polycard_client_model.polycards[]`. Imagem: `https://http2.mlstatic.com/D_Q_NP_2X_{pictureId}-AB.webp`. Endpoint INTERNO: pode mudar sem aviso.
- Categorias do portal: `ML_CATEGORY_IDS` (só `MLB1246` Beleza confirmado por captura; os outros são categorias raiz do ML e devolvem produtos). O portal NÃO tem Alimentos e Bebidas e quase não tem comida: busca por palavra ("chocolate", "café", "vinho"...) devolve utensílios/roupas (testado 10/2026). `ML_KEYWORD_SEARCHES` fica VAZIO (mecanismo pronto: palavra -> categoria decidida no servidor, filtro `isFoodTitle` pela primeira palavra do título). Alimentos vem da Shopee. Categoria com menos de 60 mais vendidos é completada sem o filtro `best_seller`.

## Amazon: link curto e "Mais vendidos" (fase 4e)

- **Link curto (extensão do CLIENTE):** mesmo pedido do botão "Obter link > Link curto" da SiteStripe (capturado 10/2026, INTERNO): `GET https://www.amazon.com.br/associates/sitestripe/getShortUrl?longUrl={https://www.amazon.com.br/dp/ASIN?linkCode=sl2&tag=TAG}&marketplaceId=526970&storeId=TAG`, dentro de uma aba da amazon.com.br com a sessão de Associados do cliente. Resposta `{ok, isOk, longUrl, shortUrl}`; `shortUrl` hoje é `https://link.amazon/...` (antes amzn.to). Tipos `amz.createLink`, `amz.productInfo`, `amz.diagnose` (`apps/extension/src/amazon.ts`).
- `link.amazon` -> `amzlinks.in` -> `amazon.com.br/dp/...&tag=`: os dois domínios estão na lista fechada (`STORE_DOMAINS`). O servidor CONFERE todo link curto da Amazon (`resolveAmazonShortLink` + `isOwnAmazonLink`: etiqueta do tenant E mesmo ASIN) no preview e no envio. Sem extensão: link longo `/dp/ASIN?tag=` (formato oficial).
- **Catálogo (vitrine compartilhada, extensão do ADMINISTRADOR):** de hora em hora lê as páginas públicas de "Mais vendidos" (`/gp/bestsellers/{slug}/?pg=N`, 2 páginas x 30 produtos, pausa de 3s) das categorias de `AMAZON_BESTSELLER_CATEGORIES` (grocery = Alimentos e Bebidas) e envia a `POST /api/catalog/amazon` (mesma chave `ML_VITRINE_TOKEN`). Captcha PARA a coleta (não insiste). Produto some após 48h sem aparecer (`VITRINE_STORES`).
- A Amazon não mostra vendidos nem comissão nas páginas: `soldCount`/`commission` ficam null; para o ranking, `popularity` = avaliações x 10 (estimativa, não gravada nem mostrada).

## Piloto automático e fila de envio (fase 5)

- Worker: `apps/worker/src/autopilot/engine.ts` (regras com relógio injetável, testes em `apps/worker/test/autopilot.test.ts`) + `queues/autopilot.ts` (BullMQ job scheduler, tick a cada 15 s; o piloto escolhe no máximo 1x por minuto). Regras puras compartilhadas com o painel: `packages/db/src/autopilot.ts` (importável no navegador: `@achadinhos/db/autopilot`).
- Config por tenant: `AutopilotSettings` (página Agendamento). Horários no fuso America/Sao_Paulo; "hoje" = dia em São Paulo.
- Tick: (1) descarta posts vencidos (`expiresAt`) como DISCARDED, nunca envia atrasado; (2) ofertas manuais (`sendRequestedAt` sem `sendQueuedAt`) viram posts MANUAL (esperam a janela por até 24h); (3) piloto: dentro de dia/janela e do ritmo (60/`offersPerHour` min) escolhe o produto de maior `score` que passa nos filtros, com `lastSeenAt` nas últimas `AUTOPILOT_MAX_PRICE_AGE_HOURS` (padrão 6), de loja utilizável, não postado (loja + id + grupo) há `repeatDays`; cria Offer + 1 Post AUTO por grupo (expira em 60 min ou no fim da janela); (4) envio: 1 post por número por vez, intervalo aleatório `groupIntervalMin/MaxSeconds` (30 a 90 s).
- **Regra das lojas no piloto: link CURTO sempre.** Shopee: link curto da API do cliente, gerado no servidor. Mercado Livre (só com `ML_AUTOPILOT_ENABLED=true`; a dona do produto confirmou em 10/2026 que o link longo matt_word/matt_tool gera comissão) e Amazon: o post nasce `AWAITING_LINK` e só é liberado quando a extensão DO CLIENTE (Chrome aberto, ligada ao piloto na página Extensão, chave em `ExtensionToken`, só o hash no banco) gera o meli.la / link.amazon (mesmos pedidos do modo manual) e o servidor confere (ML: etiqueta + ferramenta; Amazon: tag + mesmo ASIN). A extensão chama `POST /api/extension/autopilot` a cada 1 min (sinal de vida + entrega dos links + próximos pendentes). O piloto só escolhe ML/Amazon se a extensão deu sinal de vida nos últimos 10 min (`SHORT_LINK_STORES`); link que não chega no prazo -> DISCARDED. **Nunca enviar ML nem Amazon com link longo pelo piloto.**
- Limites contados no backend: plano `maxPostsPerDay` = OFERTAS distintas enviadas no dia (1 oferta para 10 grupos conta 1); número = MENSAGENS/dia (`channelDailyLimit`, padrão 80) com aquecimento pela 1ª conexão (`Channel.firstConnectedAt`): 20 no dia 1 subindo até o limite no dia 7. "Cabe na hora": `maxOffersPerHour` = 3600 / (grupos do número com mais grupos x intervalo máximo + 5 min); o painel não salva acima.
- Falhas: 3 tentativas por post (1, 5, 15 min); 3 posts seguidos com falha no número -> `Channel.autopilotPausedAt` + faixa no painel (Retomar na página Agendamento). Credencial que não gera link -> `StoreCredential.autopilotPausedAt` (só aquela loja; volta ao salvar a credencial de novo).
- Link por grupo: Shopee gera o link com subIds [tenant, grupo] na hora do envio e troca no texto daquele post. Histórico imutável: o Post guarda texto final, link, preço, imagem, loja e produto enviados.
- Modo acelerado (só dev): `AUTOPILOT_DEV_FAST=true` com NODE_ENV != production -> tick 5 s, 1 oferta a cada 2 min, 5 a 10 s entre grupos, descarte em 10 min, botão "Escolher oferta agora (teste)".
- Vitrine pela extensão (fase 4d/4e) com limites aprovados: pausa aleatória ML 3 a 6 s e Amazon 5 a 10 s; até 100 páginas/h no ML e 30/h na Amazon (janela móvel); captcha/bloqueio em qualquer loja para TUDO por 1 hora; "Atualizar agora" só 15 min depois da última rodada.

## Links, cliques e vendas por grupo (fase 6)

- **Decisão da dona do produto (10/2026): a mensagem leva SEMPRE o link curto da própria loja** (Shopee, meli.la, link.amazon): passa mais confiança e não depende do nosso servidor. Clique em link de terceiro não passa por nós, então **cliques não são contados pelo sistema**; os números vêm dos relatórios das lojas.
- **Shopee (feito):** a API de afiliados NÃO tem relatório de cliques (conferido no esquema GraphQL: só `conversionReport`, `validatedReport`, `partnerOrderReport`). O `conversionReport` traz em `utmContent` os subIds do link ([tenant, grupo]). Worker `queues/reports.ts` (de hora em hora, últimos 35 dias: status pendente -> concluído muda por semanas) lê com a credencial DO CLIENTE (`ShopeeReportReader`, só leitura) e grava `Conversion` por pedido (grupo, status, clique, compra, valor, comissão, oferta pelo item). 1º subId tem que ser o próprio tenant e o 2º um grupo DELE; venda repetida só atualiza. Página **Relatórios**: vendas e comissão (confirmada/pendente) por grupo, 7 e 30 dias.
- **Mercado Livre (feito, total da conta):** a extensão DO CLIENTE (ligada ao painel, mesma chave do piloto) lê de hora em hora `GET https://www.mercadolivre.com.br/affiliate-program/api/dashboard/general?filter_time_range={ini}--{fim}&metric_tab=general&type=GENERAL&page=1` (capturado 10/2026, INTERNO; período em -03:00 até hoje 00:00) para 7 e 30 dias: `data` (clicks, buyers, requests = pedidos, orders = unidades, sales), `commissions` (summary = ganho estimado), `sales` (total_not_effective_sales). Envia a `POST /api/extension/reports`; guarda o último retrato em `StoreReportSnapshot` (tenant, loja, 7/30 dias). Relatórios mostra cliques, compradores, pedidos, unidades, vendas, ganho e conversão. O ML separa por **etiqueta** (aba Etiquetas de rastreamento), não por link: por grupo só com uma etiqueta por grupo (não feito).
- **Amazon (feito, total da conta):** a mesma extensão lê de hora em hora `GET https://associados.amazon.com.br/reporting/summary?query[start_date]=AAAA-MM-DD&query[end_date]=AAAA-MM-DD&query[type]=earning&query[storeId]={tag}&query[locale]=BR&store_id={tag}` (capturado 10/2026, INTERNO; período até ONTEM; roda numa aba de associados.amazon.com.br). Exige os cabeçalhos da página: a extensão lê de `https://associados.amazon.com.br/p/reporting/earnings` o `<meta name="csrf-token">` (X-Csrf-Token) e o JSON de `<div id="pageState" data-page-state>` (`associateIdentityToken` -> Authorization Bearer, customerId, storeId, marketplaceId, programId, roles, locale) e manda igual; se o `storeId` logado for diferente da etiqueta em Credenciais, não lê. Tokens nunca saem do navegador para 7 e 30 dias: `total.table` (clicks, ordered_items = pedidos, shipped_items = enviados, ordered_revenue, returned_revenue, total_earnings), valores em texto. Mesmo `StoreReportSnapshot` (store AMAZON; buyers = 0). A etiqueta vem de `GET /api/extension/reports` (credencial do cliente). Separa por etiqueta, não por link.
- **Link rastreável próprio `/o/[codigo]` (pronto, DESLIGADO):** só com `TRACKED_LINKS_ENABLED=true` o worker troca o link por `{SHORT_LINK_BASE_URL ou APP_URL}/o/{Post.shortCode}` (7 caracteres, um por post). Rota pública registra `Click` (tenant, grupo, oferta, post, data, user-agent) e redireciona 302 só para https; IP nunca guardado (`ipHash` = HMAC-SHA256 com `CLICK_HASH_SECRET`); robôs de prévia/buscadores/ferramentas, HEAD, prefetch e o mesmo IP no mesmo post em 30 min não contam. Domínio curto separado: nele só `/o/` responde, o resto redireciona (308) para o `APP_URL` (`lib/short-domain.ts`; 127.0.0.1 e localhost contam como o mesmo).
- Remover um número: cliques perdem só o vínculo (`postId`/`groupId` = null) antes de apagar posts e grupos.

## WhatsApp (Baileys)

- **Baileys fixado em versão exata (`7.0.0-rc14`, sem ^/~). Só atualizar depois de testar a versão nova** (conectar por QR, reconectar, listar grupos, enviar teste) num número de teste.
- Sessão SÓ no Postgres: `WhatsAppSession` (creds) + `WhatsAppSessionKey` (chaves Signal, 1 linha por chave), AES-256-GCM com `WHATSAPP_SESSION_KEY`, AAD `wa:<channelId>:<tipo>:<id>`. Nunca `useMultiFileAuthState` nem arquivo em disco (Railway apaga a cada deploy).
- Painel -> worker só pela fila `whatsapp` (`@achadinhos/jobs`). Worker -> painel: status no banco (`Channel.status/statusReason`) e QR no Redis (`wa:qr:<channelId>`, 60s). Painel consulta `/api/whatsapp/channels/[id]`.
- Todo job revalida no worker que o canal é do `tenantId` do job.
- Um número = um socket em um único worker: trava `wa:lock:<channelId>` no Redis. Dev e produção usam projetos Railway separados (bancos e Redis diferentes).
- Reconexão: decisão em `reconnect.ts` (515 reconecta já; 401/411 = LOGGED_OUT e apaga sessão; 440/403 = ERROR e para; QR expirado = DISCONNECTED; resto = backoff 2s→5min).
- Envio de teste: máx. 10/número/hora e 20s entre envios (`rate-limit.ts`). Imagem por URL: só https, 10s, 5 MB, jpeg/png/webp, bloqueia IP interno; falhou = envia só texto com aviso.
- Reinício rápido do worker (Ctrl+C no Windows) pode deixar a trava do número no Redis por até 60 s: `startAll` tenta reconectar de novo depois que ela expira (3 tentativas).
- Envio em massa só pela fila da fase 5 (limite por número, aquecimento, intervalo aleatório entre mensagens). Não criar outro caminho de envio em massa.
- Imports sem extensão (moduleResolution `Bundler`).

## Regras

- **Nunca commitar segredos** (`.env`, tokens, chaves de criptografia, dados de sessão do WhatsApp).
- **Nunca usar Docker** — nem Dockerfile, nem docker-compose. Dev roda direto no Windows; deploy no Railway (Railpack/Nixpacks).
- Migration é sempre revisada (SQL mostrado ao usuário) antes do commit. Nunca editar migration já aplicada; criar nova.
- Commits em pt-BR, prefixados pela fase quando aplicável (ex.: `fase 1: ...`).
