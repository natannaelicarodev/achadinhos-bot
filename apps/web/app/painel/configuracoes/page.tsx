import { getCurrentSubscription, listStoreCredentials } from "@achadinhos/db";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { STORES } from "@/lib/stores";
import { deleteStoreCredentialAction } from "./actions";
import { StoreCredentialForm } from "./store-credential-form";

const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const STATUS_LABEL = {
  TRIALING: "Teste grátis",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
} as const;

export default async function ConfiguracoesPage() {
  const { user } = await requireSession();
  const isOwner = user.role === "OWNER";
  const [subscription, credentials] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    isOwner ? listStoreCredentials(user.tenantId) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Configurações" description="Conta, plano e credenciais das lojas." />
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

        {isOwner ? (
          <Card className="lg:row-span-2">
            <CardHeader>
              <CardTitle>Credenciais de lojas</CardTitle>
              <CardDescription>
                Guardadas criptografadas (AES-256-GCM). Depois de salvas, só aparecem mascaradas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StoreCredentialForm />
            </CardContent>
          </Card>
        ) : null}

        {isOwner ? (
          <Card>
            <CardHeader>
              <CardTitle>Lojas conectadas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {credentials.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma credencial salva ainda.</p>
              ) : (
                credentials.map((credential) => (
                  <div key={credential.id} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        {STORES[credential.store].label}
                        {credential.label ? ` · ${credential.label}` : ""}
                      </p>
                      <ul className="mt-1 text-muted-foreground">
                        {credential.fields.map((field) => (
                          <li key={field.name}>
                            {field.name}: <span className="font-mono">{field.masked}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Atualizado em {dateTime.format(credential.updatedAt)}
                      </p>
                    </div>
                    <form action={deleteStoreCredentialAction}>
                      <input type="hidden" name="store" value={credential.store} />
                      <Button type="submit" variant="outline" size="sm">
                        Remover
                      </Button>
                    </form>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
