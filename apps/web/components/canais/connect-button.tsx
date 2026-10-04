"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { connectWhatsappAction, type ActionResult } from "@/app/painel/canais/actions";
import { ActionMessage } from "./action-message";

export function ConnectButton({ disabled, disabledReason }: { disabled: boolean; disabledReason?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="grid gap-2">
      <Button
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const r = await connectWhatsappAction();
            setResult(r);
            if (!r.error) router.refresh();
          })
        }
        className="w-fit"
      >
        <PlusIcon />
        {pending ? "Preparando..." : "Conectar número"}
      </Button>
      {disabled && disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
      {result?.error ? <ActionMessage result={{ error: result.error }} /> : null}
    </div>
  );
}
