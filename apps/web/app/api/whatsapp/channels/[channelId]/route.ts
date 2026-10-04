// Status do número para o painel (consultado a cada poucos segundos).
import { forTenant } from "@achadinhos/db";
import QRCode from "qrcode";
import { getCurrentSession } from "@/lib/auth/current";
import { getQrCode } from "@/lib/queue";

export async function GET(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const { channelId } = await params;
  const channel = await forTenant(session.user.tenantId).channel.findUnique({
    where: { id: channelId },
    select: { id: true, type: true, status: true, statusReason: true, externalId: true },
  });
  if (!channel || channel.type !== "WHATSAPP") return Response.json({ error: "Não encontrado." }, { status: 404 });

  let qr: string | null = null;
  if (channel.status === "QR_PENDING") {
    const raw = await getQrCode(channel.id).catch(() => null);
    if (raw) qr = await QRCode.toDataURL(raw, { margin: 1, width: 264, errorCorrectionLevel: "M" });
  }

  return Response.json(
    { status: channel.status, statusReason: channel.statusReason, phone: channel.externalId, qr },
    { headers: { "Cache-Control": "no-store" } },
  );
}
