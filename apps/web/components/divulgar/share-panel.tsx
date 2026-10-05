"use client";

import { formatBRL, messageVariables, renderMessage } from "@achadinhos/stores/message";
import { CopyIcon, ImageIcon, Loader2Icon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { confirmExtensionLinkAction, sendToGroupsAction, type SharePreview } from "@/app/painel/divulgar-link/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyImage, copyText } from "@/lib/clipboard";
import { callExtension, detectExtension } from "@/lib/extension-client";
import { WhatsappPreview } from "./whatsapp-preview";

const centsToInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
function inputToCents(value: string): number | null {
  const n = Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

type Notice = { text: string; tone: "ok" | "warn" | "info"; installLink?: boolean } | null;

/** Link de afiliado + mensagem pronta + Copiar / Enviar para meus grupos. */
export function SharePanel({ preview, editableInfo }: { preview: SharePreview; editableInfo: boolean }) {
  const [headline, setHeadline] = useState(preview.settings.headline);
  const [title, setTitle] = useState(preview.info.title ?? "");
  const [price, setPrice] = useState(centsToInput(preview.info.priceCents));
  const [originalPrice, setOriginalPrice] = useState(centsToInput(preview.info.originalPriceCents));
  const [imageUrl, setImageUrl] = useState(preview.info.imageUrl ?? "");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState(preview.link);
  const [shortLink, setShortLink] = useState(preview.shortLink);
  const [notice, setNotice] = useState<Notice>(
    preview.notice ? { text: preview.notice, tone: preview.shortLink ? "ok" : "warn" } : null,
  );
  // Extensão gera o link curto do cliente (ML: meli.la; Amazon: link.amazon pela SiteStripe)
  // e lê o preço real no navegador dele. Enquanto gera, o link longo não aparece.
  const extensionTarget = preview.shortLink
    ? null
    : preview.mlTag
      ? ({ store: "ml", tag: preview.mlTag } as const)
      : preview.amazonTag
        ? ({ store: "amz", tag: preview.amazonTag } as const)
        : null;
  const [extensionBusy, setExtensionBusy] = useState(extensionTarget !== null);
  const [needsManualInfo, setNeedsManualInfo] = useState(preview.needsManualInfo);

  useEffect(() => {
    if (!extensionTarget) return;
    const { store, tag } = extensionTarget;
    const label = store === "ml" ? "o seu link meli.la" : "o seu link curto da Amazon";
    let cancelled = false;
    void (async () => {
      setExtensionBusy(true);
      setNotice(null);
      const installed = await detectExtension();
      if (cancelled) return;
      if (!installed) {
        setExtensionBusy(false);
        setNotice({
          text: `Instale a extensão para gerar ${label} e o preço real automaticamente. Enquanto isso, o link abaixo usa a sua etiqueta.`,
          tone: "warn",
          installLink: true,
        });
        return;
      }
      const productUrl = preview.product.productUrl;
      // Preço real em paralelo: o link curto não espera a leitura da página do produto.
      void callExtension(store === "ml" ? "ml.productInfo" : "amz.productInfo", { productUrl }).then((info) => {
        if (cancelled || !info.ok) return;
        // Preço real (com a sessão do navegador) vale mais que o do catálogo/página lida no servidor.
        if (info.data.priceCents) setPrice(centsToInput(info.data.priceCents));
        if (info.data.originalPriceCents) setOriginalPrice(centsToInput(info.data.originalPriceCents));
        if (info.data.title) setTitle((t) => t || info.data.title || "");
        if (info.data.imageUrl) setImageUrl((u) => u || info.data.imageUrl || "");
        if (info.data.title && info.data.priceCents) setNeedsManualInfo(false);
      });
      const created = await callExtension(store === "ml" ? "ml.createLink" : "amz.createLink", { productUrl, tag });
      if (cancelled) return;
      if (!created.ok) {
        setExtensionBusy(false);
        setNotice({ text: `Não foi possível gerar ${label} pela extensão: ${created.error}`, tone: "warn" });
        return;
      }
      const confirmed = await confirmExtensionLinkAction(created.data.shortUrl, productUrl);
      if (cancelled) return;
      setExtensionBusy(false);
      if (!confirmed.ok) {
        setNotice({ text: confirmed.error, tone: "warn" });
        return;
      }
      setLink(confirmed.link);
      setShortLink(confirmed.link);
      setNotice({
        text:
          store === "ml"
            ? "Link meli.la gerado pela extensão: quem clicar vê a página do Mercado Livre com a sua recomendação."
            : "Link curto da Amazon gerado pela extensão com a sua etiqueta de Associados.",
        tone: "ok",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const shownLink = extensionBusy ? null : link;
  const priceCents = inputToCents(price);
  const originalPriceCents = inputToCents(originalPrice);

  const message = useMemo(() => {
    const product = {
      title: title || "Título do produto",
      priceCents,
      originalPriceCents,
      discountPct: editableInfo ? null : preview.info.discountPct,
    };
    return renderMessage(preview.settings.body, messageVariables(product, shownLink ?? (extensionBusy ? "(gerando link...)" : "(seu link de afiliado)"), headline));
  }, [title, priceCents, originalPriceCents, headline, shownLink, extensionBusy, editableInfo, preview]);

  const flash = (ok: boolean, text: string) => setFeedback({ ok, text });

  return (
    <div className="grid gap-4">
      {/* Link de afiliado */}
      <section className="grid gap-2">
        <Label>Seu link de afiliado</Label>
        {notice ? (
          <p
            role="status"
            className={
              notice.tone === "ok"
                ? "text-xs text-green-700"
                : notice.tone === "info"
                  ? "text-xs text-muted-foreground"
                  : "text-xs text-amber-700 dark:text-amber-400"
            }
          >
            {notice.text}{" "}
            {notice.installLink ? (
              <Link href="/painel/extensao" className="font-medium underline underline-offset-4">
                Instalar extensão
              </Link>
            ) : null}
          </p>
        ) : null}
        {extensionBusy ? (
          <p role="status" className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Gerando seu link curto meli.la...
          </p>
        ) : link ? (
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
          {needsManualInfo ? (
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
        <Button type="button" variant="outline" disabled={!shownLink} onClick={async () => flash(await copyText(message), "Mensagem copiada.")}>
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
          disabled={!link || pending || extensionBusy}
          onClick={() =>
            startTransition(async () => {
              if (!priceCents) return flash(false, "Informe o preço do produto.");
              const result = await sendToGroupsAction({
                productUrl: preview.product.productUrl,
                catalogProductId: preview.catalogProductId,
                shortLink,
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
