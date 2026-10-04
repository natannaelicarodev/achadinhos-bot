import { forTenant, getCurrentSubscription } from "@achadinhos/db";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/painel/app-sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth/current";
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
  const [subscription, brokenChannels] = await Promise.all([
    getCurrentSubscription(user.tenantId),
    forTenant(user.tenantId).channel.findMany({
      where: { type: "WHATSAPP", status: { in: ALERT_STATUSES } },
      select: { id: true, externalId: true, statusReason: true },
    }),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar tenantName={user.tenant.name} userName={user.name} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <div className="ml-auto">
            <Link href="/painel/configuracoes">
              <SubscriptionBadge subscription={subscription} />
            </Link>
          </div>
        </header>
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
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
