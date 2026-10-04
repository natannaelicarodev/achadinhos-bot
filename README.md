# Achadinhos Bot

Bot de achadinhos/ofertas com painel web (Next.js) e worker (filas BullMQ, WhatsApp via Baileys).

> **Status:** fase 4c — extensão do Chrome (baixada pelo painel, menu Extensão) que gera o link meli.la e lê o preço real do Mercado Livre automaticamente. Lançamento só com WhatsApp.

## Estrutura

```
achadinhos-bot/
├── apps/
│   ├── web/        # Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
│   └── worker/     # Node + TypeScript + BullMQ + Baileys + grammY
├── packages/
│   └── db/         # Prisma (PostgreSQL) + client singleton
├── .env.example
└── pnpm-workspace.yaml
```

## Rodando no Windows (sem Docker)

### 1. Instalar o Node.js

Instale o **Node.js 24 LTS** (a versão exata está em `.nvmrc`):

- Direto: https://nodejs.org (instalador "LTS"), ou
- Via [nvm-windows](https://github.com/coreybutler/nvm-windows):
  ```powershell
  nvm install 24.14.0
  nvm use 24.14.0
  ```

Confira: `node --version` deve mostrar `v24.x`.

### 2. Ativar o pnpm

O pnpm vem com o Node via Corepack:

```powershell
corepack enable
pnpm --version   # deve mostrar 9.15.0
```

> Se `corepack enable` der erro de permissão, abra o PowerShell como administrador.

### 3. Clonar o projeto

Use uma pasta **fora** da Área de Trabalho/Documentos (o OneDrive sincroniza essas pastas e trava com `node_modules`):

```powershell
mkdir C:\projetos
cd C:\projetos
git clone <url-do-repositorio> achadinhos-bot
cd achadinhos-bot
```

### 4. Criar o banco e o Redis no Railway (ambiente dev)

1. Crie uma conta em https://railway.com.
2. **New Project** → **Deploy PostgreSQL**.
3. No mesmo projeto: **+ Create** → **Database** → **Add Redis**.
4. No serviço **Postgres** → aba **Variables** → copie `DATABASE_PUBLIC_URL`.
5. No serviço **Redis** → aba **Variables** → copie `REDIS_PUBLIC_URL`.

> Use as URLs **públicas** (`DATABASE_PUBLIC_URL` e `REDIS_PUBLIC_URL`). As internas (`*.railway.internal`) só funcionam dentro do Railway.
> Se a variável pública não existir: no serviço → **Settings** → **Networking** → **Add Public Access**.
>
> Use projetos separados no Railway para desenvolvimento e produção (ex.: `achadinhos-dev`), para o worker do seu PC nunca abrir os números de produção.

### 5. Configurar o `.env`

```powershell
copy .env.example .env
```

Abra o `.env` e:

1. Cole as URLs do passo 4 em `DATABASE_URL` e `REDIS_URL`.
2. Gere a chave de criptografia das credenciais de lojas e cole em `STORE_CREDENTIALS_KEY`:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Guarde essa chave: sem ela, as credenciais salvas não abrem mais.
   Gere **outra** chave com o mesmo comando para `WHATSAPP_SESSION_KEY` (sessões do WhatsApp).
3. E-mail: deixe `SMTP_HOST` vazio no dev — o link de "esqueci minha senha" aparece no terminal.

### 6. Instalar dependências

```powershell
pnpm install
```

Isso também roda `prisma generate` automaticamente.

### 7. Banco de dados

Aplique as migrations e cadastre os planos (Iniciante, Pro, Agência):

```powershell
pnpm db:deploy
pnpm db:seed
```

Rode os dois de novo sempre que puxar uma fase nova. Os dois podem rodar mais de uma vez sem problema.

### 8. Rodar em desenvolvimento

```powershell
pnpm dev
```

Sobe `web` e `worker` em paralelo:

- Web: http://localhost:3000 (crie uma conta em http://localhost:3000/cadastro)
- Worker: logs no terminal (`[worker] iniciado ...`). Ele precisa de `DATABASE_URL`, `REDIS_URL` e `WHATSAPP_SESSION_KEY`; se faltar algo, mostra qual variável corrigir.

Para parar: `Ctrl + C`.

## Comandos

| Comando              | O que faz                                      |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | web + worker em modo desenvolvimento           |
| `pnpm build`         | build de todos os pacotes                      |
| `pnpm typecheck`     | checagem de tipos em todos os pacotes          |
| `pnpm test`          | testes (banco em memória, não usa o Railway)   |
| `pnpm db:generate`   | gera o Prisma Client                           |
| `pnpm db:deploy`     | aplica migrations pendentes                    |
| `pnpm db:seed`       | cadastra/atualiza os planos                    |
| `pnpm db:migrate`    | cria migration nova a partir do schema (dev)   |
| `pnpm db:studio`     | abre o Prisma Studio para ver os dados         |

## Antes de lançar: teste de compra real (comissão chega ao afiliado?)

Os testes automáticos garantem que o link é montado do jeito certo, mas só uma **compra de verdade** prova que a loja atribui a venda à sua conta de afiliado. Faça este roteiro uma vez por loja, com a **sua própria** conta de afiliado configurada em **Credenciais**.

### Cuidados (valem para todas as lojas)

1. Use uma **janela anônima** (Ctrl+Shift+N) e **não** esteja logado no portal de afiliados nem tenha clicado em link de outro afiliado antes: a loja costuma creditar o último link clicado.
2. Abra o link gerado pelo painel **direto** (cole na barra do navegador ou clique pelo WhatsApp). Não navegue para outra loja no meio.
3. Compre algo **barato e de vendedor confiável**, de preferência com "Compra garantida", e anote: loja, produto, data/hora, valor e o link usado.
4. **Algumas lojas não pagam comissão** em compra feita pela própria conta do afiliado. Se possível, peça para outra pessoa comprar pelo link (no celular dela).
5. Os prazos abaixo são típicos: cliques costumam aparecer no mesmo dia; pedidos podem levar de algumas horas a alguns dias para aparecer como "pendente" e semanas para "aprovado".

### Roteiro por loja

| Loja | Gerar o link no painel | O que conferir no seu portal de afiliado |
|---|---|---|
| **Shopee** | Catálogo > produto > **Divulgar este produto** > copiar "Seu link de afiliado" (`s.shopee.com.br/...`) | Portal de afiliados Shopee > relatório de **cliques** e de **conversões/pedidos**: o pedido aparece e o campo de **Sub ID** (utmContent) mostra o id do seu tenant |
| **Mercado Livre** | **Divulgar link** > colar o endereço de um produto do ML > copiar o link (tem `matt_word` e `matt_tool`) | Portal de Afiliados do Mercado Livre > relatório de **cliques** e **vendas** na sua etiqueta (`matt_word`) |
| **Amazon** | **Divulgar link** > colar um produto da amazon.com.br > copiar o link (`/dp/...?tag=sua-tag-20`) | Associados Amazon > **Relatórios** > cliques e **itens pedidos** filtrando pela sua tag (pode levar até 24h) |
| **Shein** | **Divulgar link** > colar um produto de br.shein.com > copiar o link (`url_from=affiliate_koc_SEUID&campaign_id=20`) | Central de afiliados da Shein > pedidos/comissões. **Confirme aqui o `campaign_id=20`**: se o pedido não aparecer e o mesmo produto comprado por um link gerado pelo app da Shein aparecer, avise para trocarmos a constante `SHEIN_CAMPAIGN_ID` |

### Registro do resultado

Para cada loja, anote: **link usado**, **data/hora da compra**, **clique apareceu? (sim/não, quando)**, **pedido apareceu? (sim/não, quando)**, **status/comissão**. Se o clique aparecer e o pedido não, espere o prazo da loja antes de concluir. Se nem o clique aparecer, o link não está atribuindo: guarde o link exato e reporte.
