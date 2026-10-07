"use client";

import { useState, useTransition } from "react";
import { recomputeHeadlinesAction } from "@/app/painel/relatorios/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RecomputeHeadlinesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [password, setPassword] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="password"
        autoComplete="current-password"
        placeholder="Sua senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-8 w-40"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !password}
        onClick={() =>
          startTransition(async () => {
            const r = await recomputeHeadlinesAction(password);
            setPassword("");
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Recalculando..." : "Recalcular tipos do catálogo"}
      </Button>
      {result ? (
        <p role="status" className={result.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
