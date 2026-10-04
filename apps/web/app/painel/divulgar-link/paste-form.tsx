"use client";

import { LinkIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { SharePanel } from "@/components/divulgar/share-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STORE_LABEL } from "@/lib/catalog";
import { previewPastedLinkAction, type SharePreview } from "./actions";

export function PasteLinkForm() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await previewPastedLinkAction(url);
      if (result.ok) setPreview(result.preview);
      else {
        setPreview(null);
        setError(result.error);
      }
    });

  return (
    <div className="grid gap-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative flex-1">
          <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Cole o endereço do produto (Mercado Livre, Shein, Shopee ou Amazon)"
            aria-label="Endereço do produto"
            className="h-10 pl-9"
            maxLength={2048}
            required
          />
        </div>
        <Button type="submit" disabled={pending || url.trim().length < 8} className="h-10">
          {pending ? "Convertendo..." : "Converter"}
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <div className="grid gap-4 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                STORE_LABEL[preview.product.store]?.className ?? "bg-muted"
              }`}
            >
              {STORE_LABEL[preview.product.store]?.label ?? preview.product.store}
            </span>
            <span className="truncate text-muted-foreground">{preview.product.productUrl}</span>
          </div>
          {/* key: um painel novo a cada link convertido */}
          <SharePanel key={preview.product.productUrl} preview={preview} editableInfo />
        </div>
      ) : null}
    </div>
  );
}
