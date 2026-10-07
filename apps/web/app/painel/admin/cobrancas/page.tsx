// Cobranças de todos os clientes (só administrador confirmado): revisão, estorno e auditoria.
import { getPrisma } from "@achadinhos/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RefundButton, ResolveReviewButton } from "@/components/assinatura/refund-button";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { isSystemAdmin } from "@/lib/ml-vitrine";

export const metadata: Metadata = { title: "Cobranças (admin) — Achadinhos Bot" };

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const day = (date: Date) => date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dateTime = (date: Date) => date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const DAY_MS = 86_400_000;

const ACTION_LABEL: Record<string, string> = {
  customer_created: "Cliente criado no Asaas",
  subscribe: "Assinou",
  change_plan: "Trocou de plano",
  change_plan_canceled: "Desistiu da troca",
  cancel: "Cancelou",
  payment_paid: "Pagamento confirmado",
  payment_overdue: "Cobrança vencida",
  payment_reversed: "Estorno/contestação",
  upgrade_paid: "Diferença do upgrade paga",
  entitlement_granted: "Direito de uso concedido",
  entitlement_revoked: "Direito de uso revogado",
  review_flagged: "Marcada para revisão",
  review_resolved: "Revisão resolvida",
  refund: "Estorno pedido",
  orphan_subscription_canceled: "Assinatura órfã cancelada",
  admin_granted: "Plano Administrador",
};

export default async function AdminCobrancasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requireSession();
  if (!isSystemAdmin(user)) notFound();
  const params = await searchParams;
  const onlyReview = params.filtro === "revisar";
  const tenantFilter = params.conta && /^[a-z0-9]{10,40}$/.test(params.conta) ? params.conta : null;
  // Operação de sistema: todas as contas.
  const prisma = getPrisma();
  const [payments, reviewCount, logs] = await Promise.all([
    prisma.payment.findMany({
      where: { ...(onlyReview ? { reviewReason: { not: null } } : {}), ...(tenantFilter ? { tenantId: tenantFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { tenant: { select: { name: true } } },
    }),
    prisma.payment.count({ where: { reviewReason: { not: null } } }),
    prisma.billingAuditLog.findMany({
      where: tenantFilter ? { tenantId: tenantFilter } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { tenant: { select: { name: true } } },
    }),
  ]);
  const now = Date.now();

  return (
    <>
      <PageHeader title="Cobranças (admin)" description="Cobranças do Asaas de todas as contas: revisão, estorno (7 dias de arrependimento) e auditoria." />
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href="/painel/admin/cobrancas?filtro=revisar" />} nativeButton={false} size="sm" variant={onlyReview ? "default" : "outline"}>
            Para revisar ({reviewCount})
          </Button>
          <Button render={<Link href="/painel/admin/cobrancas" />} nativeButton={false} size="sm" variant={!onlyReview && !tenantFilter ? "default" : "outline"}>
            Todas
          </Button>
          {tenantFilter ? <span className="self-center text-xs text-muted-foreground">Filtrando uma conta</span> : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{onlyReview ? "Cobranças para revisar" : "Últimas cobranças"}</CardTitle>
            <CardDescription>
              &quot;Para revisar&quot; = cobrança que NÃO liberou plano (valor diferente do esperado, cliente/assinatura que não
              confere, contestação de upgrade). Estorno devolve pelo mesmo meio de pagamento e pede a sua senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{onlyReview ? "Nada para revisar." : "Nenhuma cobrança ainda."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Conta</th>
                      <th className="py-2 pr-3 font-medium">Valor</th>
                      <th className="py-2 pr-3 font-medium">Vencimento</th>
                      <th className="py-2 pr-3 font-medium">Situação</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => {
                      const withinWithdrawal = p.paidAt ? now - p.paidAt.getTime() <= 7 * DAY_MS : false;
                      return (
                        <tr key={p.id} className="border-t align-top">
                          <td className="py-2 pr-3">
                            <Link href={`/painel/admin/cobrancas?conta=${p.tenantId}`} className="underline underline-offset-4">
                              {p.tenant.name}
                            </Link>
                            <span className="block text-xs text-muted-foreground">{p.kind === "UPGRADE" ? "Diferença de plano" : "Assinatura"}</span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {brl(p.valueCents)}
                            {p.expectedCents !== null && p.expectedCents !== p.valueCents ? (
                              <span className="block text-xs text-destructive">esperado {brl(p.expectedCents)}</span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3">{day(p.dueDate)}</td>
                          <td className="py-2 pr-3">
                            {p.status}
                            {p.paidAt ? ` · pago em ${day(p.paidAt)}` : ""}
                            {withinWithdrawal && p.status !== "REFUNDED" ? <span className="block text-xs text-amber-700">dentro dos 7 dias</span> : null}
                            {p.reviewReason ? <span className="block text-xs font-medium text-destructive">Revisar: {p.reviewReason}</span> : null}
                          </td>
                          <td className="grid gap-1 py-2">
                            {p.paidAt && p.status !== "REFUNDED" ? <RefundButton paymentId={p.id} /> : null}
                            {p.reviewReason ? <ResolveReviewButton paymentId={p.id} /> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trilha de auditoria</CardTitle>
            <CardDescription>Tudo que mexeu em dinheiro ou plano: quem (cliente, administrador, Asaas, sistema), quando e o quê.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {logs.map((log) => (
                <li key={log.id} className="border-t pt-1">
                  <span className="text-muted-foreground">{dateTime(log.createdAt)}</span> · {log.tenant.name} ·{" "}
                  <strong>{ACTION_LABEL[log.action] ?? log.action}</strong> <span className="text-xs text-muted-foreground">({log.actor})</span>
                  {log.details ? <code className="block truncate text-xs text-muted-foreground">{JSON.stringify(log.details)}</code> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
