"use client";

import { formatBRL, messageVariables, renderMessage } from "@achadinhos/stores/message";
import { CopyIcon, ImageIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { sendToGroupsAction, type SharePreview } from "@/app/painel/divulgar-link/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyImage, copyText } from "@/lib/clipboard";
import { WhatsappPreview } from "./whatsapp-preview";

const centsToInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
function inputToCents(value: string): number | null {
  const n = Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Link de afiliado + mensagem pronta + Copiar / Enviar para meus grupos. */
export function SharePanel({ preview, editableInfo }: { preview: SharePreview; editableInfo: boolean }) {
  const [headline, setHeadline] = useState(preview.settings.headline);
  const [title, setTitle] = useState(preview.info.title ?? "");
  const [price, setPrice] = useState(centsToInput(preview.info.priceCents));
  const [originalPrice, setOriginalPrice] = useState(centsToInput(preview.info.originalPriceCents));
  const [imageUrl, setImageUrl] = useState(preview.info.imageUrl ?? "");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const priceCents = inputToCents(price);
  const originalPriceCents = inputToCents(originalPrice);
  const link = preview.link;

  const message = useMemo(() => {
    const product = {
      title: title || "Título do produto",
      priceCents,
      originalPriceCents,
      discountPct: editableInfo ? null : preview.info.discountPct,
    };
    return renderMessage(preview.settings.body, messageVariables(product, link ?? "(seu link de afiliado)", headline));
  }, [title, priceCents, originalPriceCents, headline, link, editableInfo, preview]);

  const flash = (ok: boolean, text: string) => setFeedback({ ok, text });

  return (
    <div className="grid gap-4">
      {/* Link de afiliado */}
      <section className="grid gap-2">
        <Label>Seu link de afiliado</Label>
        {link ? (
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copiar link"
              onClick={async () => flash(await copyText(link), "Link copiado.")}
            >
              <CopyIcon />
            </Button>
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="grid gap-2">
              <span>{preview.linkError}</span>
              {preview.missingCredential ? (
                <Button render={<Link href="/painel/credenciais" />} nativeButton={false} size="sm" className="w-fit">
                  Configurar credenciais
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* Dados do produto (editáveis no "Divulgar link") */}
      {editableInfo ? (
        <section className="grid gap-3 rounded-lg border p-3">
          {preview.needsManualInfo ? (
            <p className="text-xs text-muted-foreground">
              Não consegui ler todos os dados da página da loja. Confira e preencha os campos abaixo.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="share-title">Título</Label>
            <Input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="share-price">Preço (por)</Label>
              <Input id="share-price" inputMode="decimal" placeholder="59,90" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="share-original">Preço original (de) — opcional</Label>
              <Input id="share-original" inputMode="decimal" placeholder="99,90" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="share-image">URL da imagem — opcional</Label>
            <Input id="share-image" type="url" placeholder="https://..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </div>
        </section>
      ) : null}

      {/* Mensagem */}
      <section className="grid gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label htmlFor="share-headline">Mensagem pronta para divulgar</Label>
          <Link href="/painel/configuracoes#mensagem" className="text-xs text-muted-foreground underline underline-offset-4">
            Editar modelo
          </Link>
        </div>
        <Input
          id="share-headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={120}
          aria-label="Chamada da mensagem ({headline})"
          placeholder="Chamada (ex.: 🔥 ACHADINHO DO DIA)"
        />
        <WhatsappPreview text={message} imageUrl={imageUrl || null} />
        {priceCents ? (
          <p className="text-xs text-muted-foreground">
            Preço na mensagem: {formatBRL(priceCents)}
            {originalPriceCents && originalPriceCents > priceCents ? ` (de ${formatBRL(originalPriceCents)})` : ""}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!link} onClick={async () => flash(await copyText(message), "Mensagem copiada.")}>
          <CopyIcon /> Copiar mensagem
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!imageUrl}
          onClick={async () => {
            const copied = await copyImage(imageUrl);
            flash(
              copied,
              copied
                ? "Imagem copiada."
                : "Não foi possível copiar a imagem neste navegador. Clique com o botão direito na imagem e copie.",
            );
          }}
        >
          <ImageIcon /> Copiar imagem
        </Button>
        <Button
          type="button"
          disabled={!link || pending}
          onClick={() =>
            startTransition(async () => {
              if (!priceCents) return flash(false, "Informe o preço do produto.");
              const result = await sendToGroupsAction({
                productUrl: preview.product.productUrl,
                catalogProductId: preview.catalogProductId,
                headline,
                title,
                priceCents,
                originalPriceCents,
                imageUrl: imageUrl || null,
              });
              flash(result.ok, result.ok ? result.message : result.error);
            })
          }
        >
          <SendIcon /> {pending ? "Salvando..." : "Enviar para meus grupos"}
        </Button>
      </div>

      {feedback ? (
        <p role="status" className={feedback.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
