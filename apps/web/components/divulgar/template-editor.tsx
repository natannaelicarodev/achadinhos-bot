"use client";

import {
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE_TEMPLATE,
  messageVariables,
  renderMessage,
  validateTemplate,
} from "@achadinhos/stores/message";
import { useMemo, useState, useTransition } from "react";
import { resetTemplateAction, saveTemplateAction, type TemplateResult } from "@/app/painel/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WhatsappPreview } from "./whatsapp-preview";

const SAMPLE = { title: "Fone Bluetooth JBL Tune 520BT", priceCents: 19990, originalPriceCents: 34990, discountPct: 43 };

export function TemplateEditor(props: { body: string; headline: string; canEdit: boolean }) {
  const [body, setBody] = useState(props.body);
  const [headline, setHeadline] = useState(props.headline);
  const [result, setResult] = useState<TemplateResult | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(
    () => renderMessage(body, messageVariables(SAMPLE, "https://s.shopee.com.br/exemplo", headline)),
    [body, headline],
  );
  const errors = validateTemplate(body);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tpl-headline">Chamada padrão ({"{headline}"})</Label>
          <Input id="tpl-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} disabled={!props.canEdit} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tpl-body">Modelo da mensagem</Label>
          <Textarea id="tpl-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} disabled={!props.canEdit} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">
            Variáveis: {"{headline} {titulo} {preco_de} {preco_por} {desconto} {link}"}. Linha com variável sem valor (ex.: produto
            sem desconto) não aparece. Use *negrito*, _itálico_ e ~riscado~ como no WhatsApp.
          </p>
          {errors.length ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
        </div>
        {props.canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || errors.length > 0}
              onClick={() => startTransition(async () => setResult(await saveTemplateAction({ body, headline })))}
            >
              {pending ? "Salvando..." : "Salvar modelo"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await resetTemplateAction();
                  if (r.ok) {
                    setBody(DEFAULT_MESSAGE_TEMPLATE);
                    setHeadline(DEFAULT_HEADLINE);
                  }
                  setResult(r);
                })
              }
            >
              Restaurar padrão
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Só o dono da conta pode alterar o modelo.</p>
        )}
        {result ? (
          <p role="status" className={result.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
            {result.ok ? result.message : result.error}
          </p>
        ) : null}
      </div>
      <div className="grid content-start gap-1.5">
        <Label>Prévia (produto de exemplo)</Label>
        <WhatsappPreview text={preview} />
      </div>
    </div>
  );
}
