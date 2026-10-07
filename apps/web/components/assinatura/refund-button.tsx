"use client";

import { useState, useTransition } from "react";
import { refundPaymentAction, resolveReviewAction } from "@/app/painel/admin/cobrancas/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Estornar (administrador): confirmação na própria linha + senha. */
export function RefundButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [cancel, setCancel] = useState(true);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (result?.ok) return <span className="text-xs text-green-700">{result.text}</span>;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Estornar
      </Button>
    );
  }
  return (
    <div className="grid gap-1 text-xs">
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
        Encerrar o acesso também (arrependimento)
      </label>
      <Input
        type="password"
        autoComplete="current-password"
        placeholder="Sua senha para confirmar"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-8"
      />
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending || !password}
          onClick={() =>
            start(async () => {
              const r = await refundPaymentAction({ paymentId, cancelSubscription: cancel, password });
              setPassword("");
              setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            })
          }
        >
          {pending ? "Estornando..." : "Confirmar estorno"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
      {result && !result.ok ? <p className="text-destructive">{result.text}</p> : null}
    </div>
  );
}

/** "Marcar como revisada" (com o que foi feito: fica na trilha de auditoria). */
export function ResolveReviewButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (result?.ok) return <span className="text-xs text-green-700">{result.text}</span>;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Marcar como revisada
      </Button>
    );
  }
  return (
    <div className="grid gap-1 text-xs">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que foi feito (ex.: estornado, cliente avisado)" maxLength={500} className="h-8" />
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          disabled={pending || note.trim().length < 3}
          onClick={() =>
            start(async () => {
              const r = await resolveReviewAction({ paymentId, note });
              setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            })
          }
        >
          Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
      {result && !result.ok ? <p className="text-destructive">{result.text}</p> : null}
    </div>
  );
}
