"use client";

import { useState, useTransition } from "react";
import { resendVerificationAction } from "@/lib/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Faixa "Confirme seu e-mail" com "Reenviar link" (o servidor limita a 1 a cada 2 minutos). */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <Alert role="alert" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>
          <strong>Confirme seu e-mail</strong> ({email}) para assinar um plano e enviar ofertas aos grupos. O link está na sua caixa
          de entrada.
        </span>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setResult(await resendVerificationAction()))}>
          {pending ? "Enviando..." : "Reenviar link"}
        </Button>
        {result ? <span className={result.ok ? "text-green-700" : "text-destructive"}>{result.message}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
