import { forTenant, getCurrentSubscription, getPrisma, planAllowsSending } from "@achadinhos/db";
import { captionProvider } from "@achadinhos/stores";
import Link from "next/link";
import { TrackClicksToggle } from "@/components/configuracoes/track-clicks-toggle";
import { TemplateEditor } from "@/components/divulgar/template-editor";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMessageSettings } from "@/lib/affiliate-server";
import { requireSession } from "@/lib/auth/current";
import { trackedLinksBase } from "@/lib/short-domain";

/** Produto de exemplo da prévia do modelo (o mesmo do editor). */
const SAMPLE_PRODUCT = { title: "Fone Bluetooth JBL Tune 520BT", discountPct: 43 };

const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const REPORTS_LABEL = {
  BASIC: "Relatórios: cliques por dia e por loja, vendas da Shopee por grupo",
  GROUPS: "Relatórios: + por grupo, taxa de cliques, por oferta e ofertas que mais venderam",
  FULL: "Relatórios completos + exportar CSV",
} as const;

const STATUS_LABEL = {
  TRIALING: "Teste grátis",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
} as const;

export default async function ConfiguracoesPage() {
  const { user } = await requireSession();
  const isOwner = user.role === "OWNER";
  const [subscription, settings, plans, autopilot] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    getMessageSettings(user.tenantId),
    getPrisma().plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
    forTenant(user.tenantId).autopilotSettings.findUnique({ where: { tenantId: user.tenantId }, select: { trackClicks: true } }),
  ]);
  const clicksBase = trackedLinksBase();
  const canSend = Boolean(subscription && planAllowsSending(subscription.plan));

  return (
    <>
      <PageHeader title="Configurações" description="Conta, plano, credenciais de afiliado e mensagem de divulgação." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">Negócio:</span> {user.tenant.name}
            </p>
            <p>
              <span className="text-muted-foreground">Você:</span> {user.name} ({user.email})
            </p>
            {subscription ? (
              <p>
                <span className="text-muted-foreground">Plano:</span> {subscription.plan.name} —{" "}
                {price.format(subscription.plan.priceCents / 100)}/mês · {STATUS_LABEL[subscription.status]}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credenciais de afiliado</CardTitle>
            <CardDescription>Shopee, Mercado Livre, Amazon e Shein: é com elas que seus links rendem comissão.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/painel/credenciais" />} nativeButton={false} variant="outline">
              Configurar credenciais
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" id="plano">
          <CardHeader>
            <CardTitle>Planos</CardTitle>
            <CardDescription>
              Para assinar, trocar de plano ou cancelar, use a página{" "}
              <Link href="/painel/assinatura" className="underline underline-offset-4">
                Assinatura
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const current = subscription?.plan.id === plan.id;
              return (
                <div key={plan.id} className={`grid content-start gap-1 rounded-lg border p-3 text-sm ${current ? "border-primary" : ""}`}>
                  <p className="font-semibold">
                    {plan.name} {current ? <span className="text-xs font-normal text-primary">(seu plano)</span> : null}
                  </p>
                  <p>
                    <span className="text-lg font-semibold">{price.format(plan.priceCents / 100)}</span>/mês
                  </p>
                  <p className="text-xs text-muted-foreground">ou {price.format(plan.annualPriceCents / 100)}/ano</p>
                  <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                    {plan.maxWhatsappNumbers === 0 ? (
                      <li>Catálogo, credenciais, conversão de links e mensagem pronta para copiar (sem envio aos grupos)</li>
                    ) : (
                      <>
                        <li>
                          {plan.maxWhatsappNumbers} {plan.maxWhatsappNumbers === 1 ? "número" : "números"} de WhatsApp
                        </li>
                        <li>{plan.maxGroups === null ? "Grupos ilimitados" : `${plan.maxGroups} grupos`}</li>
                        <li>{plan.maxPostsPerDay} ofertas por dia</li>
                        <li>
                          {plan.maxUsers} {plan.maxUsers === 1 ? "usuário" : "usuários"}
                        </li>
                        <li>
                          {plan.aiCaptionsPerMonth === null ? "Legendas com IA ilimitadas" : `${plan.aiCaptionsPerMonth} legendas com IA por mês`}
                        </li>
                        <li>{REPORTS_LABEL[plan.reportsLevel]}</li>
                      </>
                    )}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {canSend && clicksBase ? (
          <Card className="lg:col-span-2" id="cliques">
            <CardHeader>
              <CardTitle>Cliques nos seus links</CardTitle>
              <CardDescription>Escolha se o painel conta os cliques das mensagens enviadas aos seus grupos.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrackClicksToggle enabled={autopilot?.trackClicks ?? false} base={clicksBase} canEdit={isOwner} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2" id="mensagem">
          <CardHeader>
            <CardTitle>Mensagem de divulgação</CardTitle>
            <CardDescription>
              Modelo usado no catálogo e no Divulgar link.{settings.isDefault ? " Você está usando o modelo padrão." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor
              body={settings.body}
              headline={settings.headline}
              autoHeadlines={settings.autoHeadlines}
              customHeadlines={settings.customHeadlines}
              sampleHeadline={captionProvider.pick(captionProvider.classify(SAMPLE_PRODUCT), SAMPLE_PRODUCT)}
              canEdit={isOwner}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
