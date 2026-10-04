# Achadinhos Bot

Bot de achadinhos/ofertas com painel web (Next.js) e worker (filas BullMQ, WhatsApp via Baileys, Telegram via grammY).

> **Status:** fase 0 — só o esqueleto do projeto. Sem funcionalidades ainda.

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

> Use as URLs **públicas** (`*.proxy.rlwy.net`). As internas (`*.railway.internal`) só funcionam dentro do Railway.

### 5. Configurar o `.env`

```powershell
copy .env.example .env
```

Abra o `.env` e cole as URLs do passo 4 em `DATABASE_URL` e `REDIS_URL`.

### 6. Instalar dependências

```powershell
pnpm install
```

Isso também roda `prisma generate` automaticamente.

### 7. Banco de dados

Na fase 0 ainda não há models, então **não** há migration. Para gerar o client manualmente:

```powershell
pnpm db:generate
```

A partir da fase 1 (quando houver models):

```powershell
pnpm db:migrate
```

### 8. Rodar em desenvolvimento

```powershell
pnpm dev
```

Sobe `web` e `worker` em paralelo:

- Web: http://localhost:3000 (rota de teste: http://localhost:3000/api/health)
- Worker: logs no terminal (`[worker] iniciado ...`)

Para parar: `Ctrl + C`.

## Comandos

| Comando              | O que faz                                      |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | web + worker em modo desenvolvimento           |
| `pnpm build`         | build de todos os pacotes                      |
| `pnpm typecheck`     | checagem de tipos em todos os pacotes          |
| `pnpm test`          | testes (quando existirem)                      |
| `pnpm db:generate`   | gera o Prisma Client                           |
| `pnpm db:migrate`    | cria/aplica migrations (a partir da fase 1)    |
