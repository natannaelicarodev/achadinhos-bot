# Achadinhos Bot

Bot de achadinhos/ofertas com painel web (Next.js) e worker (filas BullMQ, WhatsApp via Baileys).

> **Status:** fase 3 — lançamento só com WhatsApp; Telegram adiado (o painel registra pedidos de interesse).

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
