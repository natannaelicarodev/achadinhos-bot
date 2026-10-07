import { forTenant, getCurrentSubscription, getPrisma, getSendingBlock } from "@achadinhos/db";
import { STORE_NAMES, type AffiliateStore } from "@achadinhos/stores";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/painel/app-sidebar";
import { TermsGate } from "@/components/termos/terms-gate";
import { VerifyEmailBanner } from "@/components/painel/verify-email-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth/current";
import { isSystemAdmin } from "@/lib/ml-vitrine";
import { TERMS_VERSION } from "@/lib/terms";
import { ALERT_STATUSES, formatPhone } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "Painel — Achadinhos Bot" };

const DAY_MS = 24 * 60 * 60 * 1000;

function SubscriptionBadge({
  subscription,
}: {
  subscription: Awaited<ReturnType<typeof getCurrentSubscription>>;
}) {
  if (!subscription) return <Badge variant="destructive">Sem assinatura</Badge>;
  if (subscription.status === "PAST_DUE") {
    return <Badge variant="destructive">Pagamento pendente</Badge>;
  }
  if (subscription.status === "TRIALING" && subscription.trialEndsAt) {
    const days = Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / DAY_MS));
    return (
      <Badge variant="secondary">
        Teste grátis: {days} {days === 1 ? "dia" : "dias"}
      </Badge>
    );
  }
  return <Badge variant="secondary">{subscription.plan.name}</Badge>;
}

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  const db = forTenant(user.tenantId);
  // Lido do banco (não da sessão em cache): logo depois do "Aceitar", o painel já abre.
  const fresh = await db.user.findUnique({ where: { id: user.id }, select: { termsVersion: true, emailVerifiedAt: true } });
  if (fresh?.termsVersion !== TERMS_VERSION) return <TermsGate />;
  const admin = isSystemAdmin({ email: user.email, emailVerifiedAt: fresh.emailVerifiedAt });
  // Cobranças para revisar (só administrador; operação de sistema).
  const reviewCount = admin ? await getPrisma().payment.count({ where: { reviewReason: { not: null } } }) : 0;
  const [subscription, sendingBlock, brokenChannels, pausedChannels, pausedStores] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    getSendingBlock(user.tenantId),
    db.channel.findMany({
      where: { type: "WHATSAPP", status: { in: ALERT_STATUSES } },
      select: { id: true, externalId: true, statusReason: true },
    }),
    // Piloto automático: número pausado após falhas (a pausa manual não vira faixa).
    db.channel.findMany({
      where: { type: "WHATSAPP", autopilotPausedAt: { not: null }, consecutiveFailures: { gt: 0 } },
      select: { id: true, externalId: true, name: true, autopilotPauseReason: true },
    }),
    db.storeCredential.findMany({ where: { autopilotPausedAt: { not: null } }, select: { store: true, lastError: true } }),
  ]);
  const autopilotAlerts = [
    ...pausedChannels.map((c) => ({
      key: c.id,
      text: `Envios do número ${formatPhone(c.externalId) || c.name} pausados. ${c.autopilotPauseReason ?? ""}`,
      href: "/painel/agendamento",
      action: "Ver e retomar",
    })),
    ...pausedStores.map((s) => ({
      key: s.store,
      text: s.lastError ?? `Piloto automático pausado na loja ${STORE_NAMES[s.store as AffiliateStore] ?? s.store}.`,
      href: "/painel/credenciais",
      action: "Corrigir credencial",
    })),
  ];

  return (
    <SidebarProvider>
      <AppSidebar tenantName={user.tenant.name} userName={user.name} admin={admin} reviewCount={reviewCount} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <div className="ml-auto">
            <Link href="/painel/assinatura">
              <SubscriptionBadge subscription={subscription} />
            </Link>
          </div>
        </header>
        {!fresh.emailVerifiedAt ? (
          <div className="grid gap-2 px-4 pt-4 md:px-6">
            <VerifyEmailBanner email={user.email} />
          </div>
        ) : null}
        {sendingBlock && sendingBlock.reason !== "EMAIL_NOT_VERIFIED" ? (
          <div className="grid gap-2 px-4 pt-4 md:px-6">
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {sendingBlock.message}{" "}
                <Link href="/painel/assinatura" className="font-medium underline underline-offset-4">
                  Ir para Assinatura
                </Link>
              </AlertDescription>
            </Alert>
          </div>
        ) : subscription?.status === "PAST_DUE" ? (
          <div className="grid gap-2 px-4 pt-4 md:px-6">
            <Alert role="alert" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <AlertDescription>
                Pagamento da assinatura em atraso. Os envios pausam se passar de 5 dias.{" "}
                <Link href="/painel/assinatura" className="font-medium underline underline-offset-4">
                  Pagar agora
                </Link>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        {brokenChannels.length > 0 ? (
          <div className="grid gap-2 px-4 pt-4 md:px-6">
            {brokenChannels.map((channel) => (
              <Alert key={channel.id} variant="destructive" role="alert">
                <AlertDescription>
                  O número {formatPhone(channel.externalId)} foi desconectado.{" "}
                  {channel.statusReason ? `${channel.statusReason} ` : ""}
                  <Link href="/painel/canais" className="font-medium underline underline-offset-4">
                    Reconectar
                  </Link>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : null}
        {autopilotAlerts.length > 0 ? (
          <div className="grid gap-2 px-4 pt-4 md:px-6">
            {autopilotAlerts.map((alert) => (
              <Alert key={alert.key} role="alert" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <AlertDescription>
                  {alert.text}{" "}
                  <Link href={alert.href} className="font-medium underline underline-offset-4">
                    {alert.action}
                  </Link>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : null}
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
