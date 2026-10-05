# DEPLOY — Achadinhos Bot

Guia do deploy em produção (Railway). Documento completo na **fase 10**; abaixo, as pendências
já decididas que precisam entrar nele.

## Pendências anotadas para a fase 10

### Domínio separado para os links curtos (fase 6) — só se ligar o link rastreável

- Hoje DESLIGADO: as mensagens levam o link curto da própria loja. Só vale se `TRACKED_LINKS_ENABLED=true`.

- Produção usa **dois domínios**:
  - `APP_URL`: o painel (login, `/painel`, APIs da extensão).
  - `SHORT_LINK_BASE_URL`: domínio curto, **só** para os links `/o/{código}` que vão nas mensagens.
- Os dois apontam para o **mesmo serviço web** no Railway (adicionar os dois domínios no serviço).
- No domínio curto só `/o/[codigo]` responde. Login, `/painel` e qualquer outra página redirecionam (308) para o
  `APP_URL` (feito no `proxy.ts`, `apps/web/lib/short-domain.ts`).
- Variáveis no Railway (painel **e** worker): `TRACKED_LINKS_ENABLED=true`, `APP_URL`, `SHORT_LINK_BASE_URL`. No painel também `CLICK_HASH_SECRET`
  (chave nova, só de produção).
- Teste depois do deploy:
  1. `https://{dominio-curto}/o/{codigo-de-um-post}` redireciona para a loja.
  2. `https://{dominio-curto}/login` e `https://{dominio-curto}/painel` vão para o `APP_URL`.
  3. O clique aparece na fila da página Agendamento.

### Outras variáveis e passos já anotados

- Depois do `pnpm db:deploy`, rodar `pnpm db:seed` (preços e limites dos planos).
- Vitrine: `ML_VITRINE_TOKEN`, `SYSTEM_ADMIN_EMAILS`.
- Piloto: `ML_AUTOPILOT_ENABLED`, `AUTOPILOT_MAX_PRICE_AGE_HOURS`. **Não** definir `AUTOPILOT_DEV_FAST`.
- Extensão de produção: gerar com o `APP_URL` de produção (o build injeta as origens do painel).
