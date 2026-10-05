import { getCurrentSubscription } from "@achadinhos/db";
import { PageHeader } from "@/components/painel/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantDb } from "@/lib/auth/current";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

export default async function InicioPage() {
  const { db, user } = await getTenantDb();
  const [channels, groups, offers, subscription] = await Promise.all([
    db.channel.count(),
    db.group.count(),
    db.offer.count(),
    getCurrentSubscription(user.tenantId),
  ]);

  const stats = [
    { label: "Canais", value: channels },
    { label: "Grupos", value: groups },
    { label: "Ofertas", value: offers },
  ];

  return (
    <>
      <PageHeader title={`Olá, ${user.name.split(" ")[0]}!`} description="Resumo da sua conta." />
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {subscription ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Plano {subscription.plan.name}</CardTitle>
            <CardDescription>
              {subscription.status === "TRIALING" && subscription.trialEndsAt
                ? `Teste grátis até ${dateFormat.format(subscription.trialEndsAt)}.`
                : subscription.status === "PAST_DUE"
                  ? "Teste encerrado. Pagamento pendente."
                  : `Renova em ${dateFormat.format(subscription.currentPeriodEnd)}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {subscription.plan.maxWhatsappNumbers === 0
              ? "Catálogo, credenciais, conversão de links e mensagem pronta para copiar."
              : `Até ${subscription.plan.maxPostsPerDay} ofertas por dia · ${
                  subscription.plan.maxGroups === null ? "grupos ilimitados" : `${subscription.plan.maxGroups} grupos`
                }`}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
