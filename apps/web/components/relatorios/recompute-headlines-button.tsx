"use client";

import { useState, useTransition } from "react";
import { recomputeHeadlinesAction } from "@/app/painel/relatorios/actions";
import { Button } from "@/components/ui/button";

export function RecomputeHeadlinesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await recomputeHeadlinesAction();
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
