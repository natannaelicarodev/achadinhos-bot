import { ADMIN_PLAN, forTenant, getCurrentSubscription, getPrisma, getSendingBlock, isPaidStatus, type Plan } from "@achadinhos/db";
import type { Metadata } from "next";
import Link from "next/link";
import { BillingPanel, type PlanOption } from "@/components/assinatura/billing-panel";
import { PageHeader } from "@/components/painel/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { getAsaas } from "@/lib/billing";

export const metadata: Metadata = { title: "Assinatura — Achadinhos Bot" };

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const day = (date: Date) => date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const STATUS_LABEL = { TRIALING: "Teste grátis", ACTIVE: "Ativa", PAST_DUE: "Pagamento pendente", CANCELED: "Cancelada" } as const;
const PAYMENT_LABEL: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  OVERDUE: "Vencida",
  RECEIVED: "Paga",
  CONFIRMED: "Paga",
  RECEIVED_IN_CASH: "Paga",
  REFUNDED: "Estornada",
  REFUND_REQUESTED: "Estorno pedido",
  REFUND_IN_PROGRESS: "Estorno em andamento",
  DELETED: "Removida",
  CHARGEBACK_REQUESTED: "Contestação no cartão",
};
const REPORTS = { BASIC: "Relatórios básicos", GROUPS: "Relatórios por grupo e oferta", FULL: "Relatórios completos + CSV" } as const;

function features(plan: Plan): string[] {
  if (plan.maxWhatsappNumbers === 0) {
    return ["Catálogo, credenciais, conversão de links e mensagem pronta para copiar", "Sem números de WhatsApp e sem piloto automático"];
  }
  return [
    `${plan.maxWhatsappNumbers} ${plan.maxWhatsappNumbers === 1 ? "número" : "números"} de WhatsApp`,
    plan.maxGroups === null ? "Grupos ilimitados" : `${plan.maxGroups} grupos`,
    `${plan.maxPostsPerDay} ofertas por dia`,
    plan.aiCaptionsPerMonth === null ? "Legendas com IA ilimitadas" : `${plan.aiCaptionsPerMonth} legendas com IA por mês`,
    `${plan.maxUsers} ${plan.maxUsers === 1 ? "usuário" : "usuários"}`,
    REPORTS[plan.reportsLevel],
  ];
}

export default async function AssinaturaPage() {
  const { user } = await requireSession();
  const db = forTenant(user.tenantId);
  const [subscription, block, plans, payments, tenant] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    getSendingBlock(user.tenantId),
    getPrisma().plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
    db.payment.findMany({ orderBy: { dueDate: "desc" }, take: 24 }),
    getPrisma().tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { asaasCustomerId: true, billingName: true, billingDocumentLast4: true } }),
  ]);
  const isAdminPlan = subscription?.plan.code === ADMIN_PLAN.code;
  const pendingPlan = subscription?.pendingPlanId ? plans.find((p) => p.id === subscription.pendingPlanId) : null;
  const openInvoice = payments.find((p) => !isPaidStatus(p.status) && ["PENDING", "OVERDUE"].includes(p.status) && p.invoiceUrl);
  const subscribed = Boolean(subscription?.asaasSubscriptionId && !subscription.canceledAt);
  const paidBefore = payments.some((p) => p.paidAt !== null);
  const options: PlanOption[] = plans.map((p) => ({
    code: p.code,
    name: p.name,
    priceCents: p.priceCents,
    annualPriceCents: p.annualPriceCents,
    features: features(p),
  }));

  return (
    <>
      <PageHeader title="Assinatura" description="Seu plano, pagamentos e cobranças." />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Situação</CardTitle>
            <CardDescription>
              Cobrança recorrente pelo Asaas (Pix, boleto ou cartão).{" "}
              <Link href="/termos" target="_blank" className="underline underline-offset-4">
                Termos de uso
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {!subscription ? (
              <p>Sua conta não tem assinatura ativa. Escolha um plano abaixo.</p>
            ) : (
              <>
                <p>
                  Plano <strong>{subscription.plan.name}</strong>
                  {isAdminPlan ? " (conta administradora, sem cobrança)" : ` · ${subscription.billingCycle === "YEARLY" ? "anual" : "mensal"}`} ·{" "}
                  {subscription.canceledAt ? "Cancelada" : STATUS_LABEL[subscription.status]}
                </p>
                {subscription.status === "TRIALING" && subscription.trialEndsAt ? (
                  <p className="text-muted-foreground">
                    Teste grátis até {day(subscription.trialEndsAt)}.
                    {subscribed ? " A primeira cobrança vence nesse dia." : " Escolha um plano para continuar depois do teste."}
                  </p>
                ) : null}
                {subscription.status === "ACTIVE" && !isAdminPlan ? (
                  <p className="text-muted-foreground">
                    {subscription.canceledAt
                      ? `Cancelada: sem novas cobranças. Você usa o plano até ${day(subscription.currentPeriodEnd)}.`
                      : `Pago até ${day(subscription.currentPeriodEnd)}; a próxima cobrança vence nesse dia.`}
                  </p>
                ) : null}
                {pendingPlan ? (
                  <p>
                    {subscription.pendingPlanAt ? "Troca para o plano" : "Plano escolhido:"} <strong>{pendingPlan.name}</strong>{" "}
                    {subscription.pendingPlanPaymentId
                      ? "— libera quando a diferença for paga."
                      : subscription.pendingPlanAt
                        ? `a partir de ${day(subscription.pendingPlanAt)}.`
                        : "— libera quando a cobrança da assinatura for paga. Até lá, os recursos continuam os do plano atual."}
                  </p>
                ) : null}
                {tenant.billingDocumentLast4 ? (
                  <p className="text-muted-foreground">
                    Cobrança em nome de {tenant.billingName ?? "—"} (documento final {tenant.billingDocumentLast4}).
                  </p>
                ) : null}
              </>
            )}
            {block ? (
              <Alert variant="destructive">
                <AlertDescription>{block.message}</AlertDescription>
              </Alert>
            ) : null}
            {openInvoice?.invoiceUrl ? (
              <Button render={<a href={openInvoice.invoiceUrl} target="_blank" rel="noreferrer" />} nativeButton={false} className="w-fit">
                Pagar agora ({brl(openInvoice.valueCents)}, vence {day(openInvoice.dueDate)})
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {!isAdminPlan ? (
          <Card>
            <CardHeader>
              <CardTitle>{subscribed ? "Trocar de plano" : "Escolha seu plano"}</CardTitle>
            </CardHeader>
            <CardContent>
              <BillingPanel
                plans={options}
                currentPlanCode={(!paidBefore && pendingPlan ? pendingPlan.code : subscription?.plan.code) ?? null}
                currentCycle={subscription?.billingCycle ?? "MONTHLY"}
                subscribed={subscribed}
                // Antes do 1º pagamento a escolha pode mudar à vontade (nada foi liberado).
                hasPendingChange={Boolean(subscription?.pendingPlanId) && paidBefore}
                hasCustomer={Boolean(tenant.asaasCustomerId)}
                canEdit={user.role === "OWNER"}
                configured={getAsaas() !== null}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Cobranças</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Vencimento</th>
                      <th className="py-2 pr-3 font-medium">Valor</th>
                      <th className="py-2 pr-3 font-medium">Situação</th>
                      <th className="py-2 pr-3 font-medium">Tipo</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-2 pr-3">{day(p.dueDate)}</td>
                        <td className="py-2 pr-3 tabular-nums">{brl(p.valueCents)}</td>
                        <td className="py-2 pr-3">
                          {PAYMENT_LABEL[p.status] ?? p.status}
                          {p.paidAt ? ` em ${day(p.paidAt)}` : ""}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{p.asaasSubscriptionId ? "Assinatura" : "Diferença de plano"}</td>
                        <td className="py-2">
                          {p.invoiceUrl ? (
                            <a href={p.invoiceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                              Ver
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
