"use client";

import { RefreshCwIcon } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import {
  sendTestAction,
  setGroupPostingAction,
  syncGroupsAction,
  type ActionResult,
} from "@/app/painel/canais/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ActionMessage } from "./action-message";

export function SyncGroupsButton({ channelId }: { channelId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        className="w-fit"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await syncGroupsAction(channelId)))}
      >
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
        {pending ? "Atualizando..." : "Atualizar grupos"}
      </Button>
      <ActionMessage result={result} />
    </div>
  );
}

export function PostingSwitch({
  groupId,
  enabled,
  disabled,
  label,
}: {
  groupId: string;
  enabled: boolean;
  disabled: boolean;
  label: string;
}) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid justify-items-end gap-1">
      <Switch
        checked={checked}
        disabled={disabled || pending}
        aria-label={label}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setChecked(next);
            const result = await setGroupPostingAction(groupId, next);
            if (result.error) {
              setChecked(!next);
              setError(result.error);
            } else {
              setError(null);
            }
          })
        }
      />
      {error ? <p className="max-w-64 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function SendTestForm({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(sendTestAction, {} as ActionResult);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Enviar teste
      </Button>
    );
  }

  return (
    <form action={action} className="grid w-full gap-3 rounded-lg border p-3">
      <input type="hidden" name="groupId" value={groupId} />
      <p className="text-sm font-medium">Mensagem de teste para “{groupName}”</p>
      <div className="grid gap-2">
        <Label htmlFor={`text-${groupId}`}>Texto</Label>
        <Textarea
          id={`text-${groupId}`}
          name="text"
          required
          maxLength={4096}
          rows={3}
          defaultValue="🔥 Teste do Achadinhos Bot: se você recebeu esta mensagem, o número está pronto para postar."
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`img-${groupId}`}>URL da imagem (opcional)</Label>
        <Input id={`img-${groupId}`} name="imageUrl" type="url" placeholder="https://..." maxLength={2048} />
        <p className="text-xs text-muted-foreground">Só https, até 5 MB, JPEG, PNG ou WebP.</p>
      </div>
      <p className="text-xs text-muted-foreground">Limite: 10 testes por hora por número, com 20s entre envios.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enviando..." : "Enviar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Fechar
        </Button>
      </div>
      <ActionMessage result={state.error || state.success ? state : null} />
    </form>
  );
}
