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

## E-mail transacional com o Resend (domínio próprio) — fase 9

O sistema manda e-mail por **SMTP** (variáveis `SMTP_*`): confirmação de e-mail, recuperação de senha e aviso
de "cobrança para revisar" aos administradores. No dev, com `SMTP_HOST` vazio, os e-mails só aparecem no terminal.

1. **Domínio:** compre o domínio antes de abrir para clientes. Recomendado mandar de um subdomínio só para
   e-mail (ex.: `mail.seudominio.com.br`), para não misturar com o site.
2. **Resend** (resend.com) > **Domains** > **Add Domain** > digite o domínio (ou subdomínio) e escolha a região.
3. O Resend mostra os **registros DNS**. Crie TODOS no painel de DNS do domínio, **copiando os valores exatos da
   tela do Resend** (os valores mudam de conta para conta):
   - **DKIM**: registro `TXT` com nome parecido com `resend._domainkey` (assinatura dos e-mails);
   - **SPF**: registro `TXT` (nome parecido com `send`) com `v=spf1 include:...`;
   - **MX** do retorno (nome parecido com `send`, prioridade 10): recebe os avisos de e-mail que voltou;
   - **DMARC** (recomendado, você cria): `TXT` com nome `_dmarc` e valor `v=DMARC1; p=none; rua=mailto:SEU-EMAIL`.
     Depois de algumas semanas sem problemas, mude para `p=quarantine`.
4. Clique em **Verify DNS Records** e espere ficar **Verified** (pode levar de minutos a algumas horas).
5. **API Keys** > **Create API Key**: permissão **Sending access**, restrita a esse domínio. Copie na hora.
6. Variáveis no Railway (no **painel E no worker**):
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASS=(a chave de API do Resend)
   SMTP_FROM="Achadinhos Bot <nao-responda@mail.seudominio.com.br>"
   ```
   O endereço do `SMTP_FROM` TEM que ser do domínio verificado.
7. **Teste:** crie uma conta nova e confira se o e-mail de confirmação chega (olhe o spam). No Resend, **Logs**
   mostra cada envio, entregue ou não.

## Cobrança (Asaas) em produção — fase 9

- `ASAAS_ENV=production`, `ASAAS_API_KEY` da conta de **produção** (gere sem permissão de saque),
  `ASAAS_WEBHOOK_TOKEN` (novo, mínimo 16 caracteres), `BILLING_DOCUMENT_SECRET` (novo, só de produção, mínimo 16;
  NUNCA trocar depois: é a chave da impressão do CPF/CNPJ). Painel e worker.
- Webhook no Asaas (**Integrações > Webhooks**): URL `https://{APP_URL}/api/asaas/webhook`, versão v3, token igual ao
  `ASAAS_WEBHOOK_TOKEN`, fila de sincronização ativada, eventos de **cobrança**.
- `SYSTEM_ADMIN_EMAILS`: as contas da lista só viram administradoras depois de **confirmar o e-mail** pelo link.
  Cadastre e confirme essas contas logo depois do deploy.
- `TERMS_COMPANY_NAME`, `TERMS_COMPANY_DOCUMENT` (CNPJ), `SUPPORT_EMAIL`: aparecem nos termos de uso.
- Depois do deploy, teste com uma cobrança real de valor baixo e estorne em **Cobranças (admin)**.
