import { getCurrentSubscription } from "@achadinhos/db";
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
  const [subscription, settings] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    getMessageSettings(user.tenantId),
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
