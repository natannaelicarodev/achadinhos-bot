import { getFeatureRequest, getWhatsappUsage, PlanLimitError } from "@achadinhos/db";
import { ConnectButton } from "@/components/canais/connect-button";
import { TelegramInterestCard } from "@/components/canais/telegram-interest-card";
import { WhatsappChannelCard } from "@/components/canais/whatsapp-channel-card";
import { PageHeader } from "@/components/painel/page-header";
import { getTenantDb } from "@/lib/auth/current";

export default async function CanaisPage() {
  const { db, user } = await getTenantDb();
  const isOwner = user.role === "OWNER";
  const [channels, usage, telegramRequest] = await Promise.all([
    db.channel.findMany({
      where: { type: "WHATSAPP" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, status: true, statusReason: true, externalId: true },
    }),
    getWhatsappUsage(user.tenantId).catch((error: unknown) => {
      if (error instanceof PlanLimitError) return { used: 0, max: 0 };
      throw error;
    }),
    getFeatureRequest(user.tenantId, "telegram"),
  ]);

  const limitReached = usage.used >= usage.max;

  return (
    <>
      <PageHeader title="Canais" description="Números de WhatsApp que postam suas ofertas." />

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">WhatsApp</h2>
            <p className="text-sm text-muted-foreground">
              {usage.used} de {usage.max} {usage.max === 1 ? "número" : "números"} do seu plano.
            </p>
          </div>
          {isOwner ? (
            <ConnectButton
              disabled={limitReached}
              disabledReason={limitReached ? "Limite de números do plano atingido. Remova um número ou mude de plano." : undefined}
            />
          ) : null}
        </div>

        {channels.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum número conectado ainda.
            {isOwner ? " Clique em Conectar número e leia o QR Code com o celular." : ""}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {channels.map((channel) => (
              <WhatsappChannelCard
                key={channel.id}
                isOwner={isOwner}
                initial={{
                  id: channel.id,
                  name: channel.name,
                  status: channel.status,
                  statusReason: channel.statusReason,
                  phone: channel.externalId,
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <TelegramInterestCard requestedAt={telegramRequest?.createdAt.toISOString() ?? null} />
      </section>
    </>
  );
}
