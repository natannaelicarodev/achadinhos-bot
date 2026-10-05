"use client";

import type { VitrineStatus } from "@achadinhos/extension/protocol";
import { useCallback, useEffect, useState } from "react";
import { vitrineSetupAction } from "@/app/painel/extensao/actions";
import { Button } from "@/components/ui/button";
import { callExtension } from "@/lib/extension-client";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Liga/desliga a vitrine compartilhada nesta extensão (só aparece para o administrador). */
export function VitrineAdmin() {
  const [status, setStatus] = useState<VitrineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callExtension("vitrine.status", {}, 3_000);
    if (result.ok) {
      setStatus(result.data);
      setError(null);
    } else setError(result.error);
    return result;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Enquanto atualiza, confere o andamento a cada 5s.
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [status?.running, refresh]);

  async function run(task: () => Promise<{ ok: true; data: VitrineStatus } | { ok: false; error: string }>) {
    setBusy(true);
    const result = await task();
    setBusy(false);
    if (result.ok) {
      setStatus(result.data);
      setError(null);
    } else setError(result.error);
  }

  const enable = () =>
    run(async () => {
      const setup = await vitrineSetupAction();
      if (!setup.ok) return setup;
      return callExtension("vitrine.configure", { enabled: true, token: setup.token, categories: setup.categories, searches: setup.searches, amazonCategories: setup.amazonCategories });
    });
  const disable = () => run(() => callExtension("vitrine.configure", { enabled: false, token: null, categories: [], searches: [], amazonCategories: [] }));
  const runNow = () => run(() => callExtension("vitrine.runNow", {}));

  if (!status) {
    return <p className="text-sm text-muted-foreground">{error ?? "Procurando a extensão..."}</p>;
  }
  return (
    <div className="grid gap-3 text-sm">
      <p>
        Status nesta extensão:{" "}
        <strong className={status.enabled ? "text-green-700" : "text-muted-foreground"}>
          {status.enabled ? "ativada" : "desativada"}
        </strong>
        {status.running ? " · atualizando agora (leva uns 5 a 6 minutos)..." : ""}
      </p>
      {status.lastRunAt ? (
        <p className={status.lastResult?.ok ? "text-muted-foreground" : "text-destructive"}>
          Última atualização: {dateTime.format(new Date(status.lastRunAt))} — {status.lastResult?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status.enabled ? (
          <>
            <Button onClick={runNow} disabled={busy || status.running}>
              Atualizar agora
            </Button>
            <Button variant="outline" onClick={disable} disabled={busy}>
              Desativar
            </Button>
          </>
        ) : (
          <Button onClick={enable} disabled={busy}>
            Ativar nesta extensão
          </Button>
        )}
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
