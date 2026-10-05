"use client";

import { useState, useTransition } from "react";
import { setTrackClicksAction } from "@/app/painel/configuracoes/actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** "Contar cliques por grupo": a mensagem leva o nosso link curto em vez do link da loja. */
export function TrackClicksToggle(props: { enabled: boolean; base: string; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(props.enabled);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <Label htmlFor="track-clicks">Contar cliques por grupo</Label>
          <p className="text-xs text-muted-foreground">
            Ligado: a mensagem enviada aos grupos mostra o nosso link curto ({props.base}/o/...) em vez do link da loja. Quem
            clica vai para o mesmo link da loja, com a sua comissão, e o clique entra nos Relatórios por dia, grupo, loja e
            oferta.
          </p>
          <p className="text-xs text-muted-foreground">
            Desligado (padrão): a mensagem leva o link curto da própria loja (Shopee, meli.la, link.amazon) e os cliques não
            são contados pelo painel. &quot;Copiar mensagem&quot; sempre usa o link da loja.
          </p>
        </div>
        <Switch
          id="track-clicks"
          checked={enabled}
          disabled={!props.canEdit || pending}
          onCheckedChange={(value) =>
            startTransition(async () => {
              const r = await setTrackClicksAction(value);
              if (r.ok) setEnabled(value);
              setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            })
          }
        />
      </div>
      {!props.canEdit ? <p className="text-muted-foreground">Só o dono da conta pode alterar.</p> : null}
      {result ? (
        <p role="status" className={result.ok ? "text-green-700" : "text-destructive"}>
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
