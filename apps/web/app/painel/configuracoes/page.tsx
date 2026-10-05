import { getCurrentSubscription, getPrisma } from "@achadinhos/db";
import Link from "next/link";
import { TemplateEditor } from "@/components/divulgar/template-editor";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMessageSettings } from "@/lib/affiliate-server";
import { requireSession } from "@/lib/auth/current";

const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_LABEL = {
  TRIALING: "Teste grátis",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
} as const;

export default async function ConfiguracoesPage() {
  const { user } = await requireSession();
  const isOwner = user.role === "OWNER";
  const [subscription, settings, plans] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    getMessageSettings(user.tenantId),
    getPrisma().plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
  ]);

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
              A troca de plano pelo painel chega junto com a cobrança automática. Até lá, para mudar de plano, fale com o
              suporte.
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
                      </>
                    )}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" id="mensagem">
          <CardHeader>
            <CardTitle>Mensagem de divulgação</CardTitle>
            <CardDescription>
              Modelo usado no catálogo e no Divulgar link.{settings.isDefault ? " Você está usando o modelo padrão." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor body={settings.body} headline={settings.headline} canEdit={isOwner} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
