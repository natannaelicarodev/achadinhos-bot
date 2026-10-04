"use client";

import type { ChannelStatus } from "@achadinhos/db";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  reconnectWhatsappAction,
  removeWhatsappAction,
  type ActionResult,
} from "@/app/painel/canais/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone, STATUS_LABEL, TRANSIENT_STATUSES } from "@/lib/whatsapp";
import { ActionMessage } from "./action-message";

export interface ChannelView {
  id: string;
  name: string;
  status: ChannelStatus;
  statusReason: string | null;
  phone: string | null;
}

interface StatusResponse {
  status: ChannelStatus;
  statusReason: string | null;
  phone: string | null;
  qr: string | null;
}

const FAST_MS = 2_000;
const SLOW_MS = 15_000;

function statusVariant(status: ChannelStatus) {
  if (status === "CONNECTED") return "default" as const;
  if (status === "LOGGED_OUT" || status === "ERROR") return "destructive" as const;
  return "secondary" as const;
}

export function WhatsappChannelCard({ initial, isOwner }: { initial: ChannelView; isOwner: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [qr, setQr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const previousStatus = useRef(initial.status);

  useEffect(() => setView(initial), [initial]);

  // Consulta o status: rápido enquanto conecta/espera QR, devagar no resto.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/whatsapp/channels/${initial.id}`, { cache: "no-store" });
        if (response.status === 404) {
          router.refresh();
          return;
        }
        if (response.ok && !cancelled) {
          const data = (await response.json()) as StatusResponse;
          setView((v) => ({ ...v, status: data.status, statusReason: data.statusReason, phone: data.phone }));
          setQr(data.qr);
          if (previousStatus.current !== "CONNECTED" && data.status === "CONNECTED") router.refresh();
          previousStatus.current = data.status;
        }
      } catch {
        // rede instável: tenta de novo no próximo ciclo
      }
      if (!cancelled) {
        timer = setTimeout(poll, TRANSIENT_STATUSES.includes(previousStatus.current) ? FAST_MS : SLOW_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initial.id, router]);

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await action();
      setResult(r);
      setConfirmRemove(false);
      if (!r.error) {
        previousStatus.current = "CONNECTING";
        router.refresh();
      }
    });

  // Qualquer estado fora "Conectado" pode tentar de novo (ex.: worker caiu no meio do QR).
  const canReconnect = view.status !== "CONNECTED";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{view.name}</CardTitle>
          <Badge variant={statusVariant(view.status)}>{STATUS_LABEL[view.status]}</Badge>
        </div>
        <CardDescription>{formatPhone(view.phone)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.statusReason ? <p className="text-sm text-muted-foreground">{view.statusReason}</p> : null}

        {view.status === "QR_PENDING" ? (
          <div className="grid justify-items-start gap-2">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR Code para conectar o WhatsApp" width={264} height={264} className="rounded-md border" />
            ) : (
              <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
            )}
            <ol className="list-decimal pl-5 text-sm text-muted-foreground">
              <li>No celular, abra o WhatsApp.</li>
              <li>Toque em Configurações (ou ⋮) e depois em Dispositivos conectados.</li>
              <li>Toque em Conectar dispositivo e aponte a câmera para este código.</li>
            </ol>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {view.status === "CONNECTED" ? (
            <Button
              render={<Link href={`/painel/canais/whatsapp/${view.id}`} />}
              nativeButton={false}
              variant="default"
              size="sm"
            >
              Ver grupos
            </Button>
          ) : null}
          {isOwner && canReconnect ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reconnectWhatsappAction(view.id))}>
              Reconectar
            </Button>
          ) : null}
          {isOwner && !confirmRemove ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmRemove(true)}>
              Remover
            </Button>
          ) : null}
        </div>

        {confirmRemove ? (
          <div className="grid gap-3 rounded-lg border border-destructive/40 p-3" role="alertdialog" aria-label="Confirmar remoção">
            <p className="text-sm">
              Remover <strong>{formatPhone(view.phone)}</strong>? O número será desconectado do WhatsApp, a sessão será
              apagada e os grupos deixam de receber posts. Para usar de novo, será preciso ler um novo QR Code.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => removeWhatsappAction(view.id))}>
                {pending ? "Removendo..." : "Sim, remover"}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmRemove(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}

        <ActionMessage result={result} />
      </CardContent>
    </Card>
  );
}
