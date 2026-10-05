"use client";

import type { AutopilotLinkStatus } from "@achadinhos/extension/protocol";
import { useCallback, useEffect, useState } from "react";
import { pairExtensionAutopilotAction, unpairExtensionAutopilotAction } from "@/app/painel/extensao/actions";
import { Button } from "@/components/ui/button";
import { callExtension } from "@/lib/extension-client";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Liga a extensão deste Chrome ao piloto automático (meli.la dos produtos do Mercado Livre). */
export function AutopilotLink() {
  const [status, setStatus] = useState<AutopilotLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callExtension("autopilot.status", {}, 3_000);
    if (result.ok) {
      setStatus(result.data);
      setError(null);
    } else setError(result.error);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function enable() {
    setBusy(true);
    const paired = await pairExtensionAutopilotAction();
    const result = paired.ok
      ? await callExtension("autopilot.configure", { enabled: true, token: paired.token })
      : { ok: false as const, error: paired.error };
    setBusy(false);
    if (result.ok) setStatus(result.data);
    else setError(result.error);
  }

  async function disable() {
    setBusy(true);
    await unpairExtensionAutopilotAction();
    const result = await callExtension("autopilot.configure", { enabled: false, token: null });
    setBusy(false);
    if (result.ok) setStatus(result.data);
    else setError(result.error);
  }

  if (!status) return <p className="text-sm text-muted-foreground">{error ?? "Procurando a extensão..."}</p>;
  return (
    <div className="grid gap-3 text-sm">
      <p>
        Nesta extensão:{" "}
        <strong className={status.enabled ? "text-green-700" : "text-muted-foreground"}>
          {status.enabled ? "ligada ao painel" : "desligada"}
        </strong>
      </p>
      {status.lastRunAt ? (
        <p className={status.lastResult?.ok ? "text-muted-foreground" : "text-destructive"}>
          Links do piloto: {dateTime.format(new Date(status.lastRunAt))} — {status.lastResult?.message}
        </p>
      ) : null}
      {status.reportsLastRunAt ? (
        <p className={status.reportsLastResult?.ok ? "text-muted-foreground" : "text-destructive"}>
          Relatórios das lojas: {dateTime.format(new Date(status.reportsLastRunAt))} — {status.reportsLastResult?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status.enabled ? (
          <Button variant="outline" onClick={() => void disable()} disabled={busy}>
            Desligar do painel
          </Button>
        ) : (
          <Button onClick={() => void enable()} disabled={busy}>
            Ligar ao painel
          </Button>
        )}
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
