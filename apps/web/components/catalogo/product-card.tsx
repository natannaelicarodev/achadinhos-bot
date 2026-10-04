"use client";

import type { CatalogCategory, Store } from "@achadinhos/db";
import { HeartIcon, StarIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { promoteProductAction, toggleFavoriteAction } from "@/app/painel/catalogo/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_LABEL, formatBRL, formatCommission, formatSold, STORE_LABEL } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export interface CatalogItemView {
  id: string;
  store: Store;
  title: string;
  imageUrl: string | null;
  productUrl: string;
  category: CatalogCategory;
  priceCents: number;
  originalPriceCents: number | null;
  discountPct: number | null;
  commissionPct: number | null;
  commissionCents: number | null;
  rating: number | null;
  soldCount: number | null;
  isFavorite: boolean;
  hasOffer: boolean;
}

function StoreBadge({ store }: { store: Store }) {
  const meta = STORE_LABEL[store];
  if (!meta) return null;
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.className)}>{meta.label}</span>;
}

function ProductImage({ item, className }: { item: CatalogItemView; className?: string }) {
  return item.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imageUrl} alt={item.title} loading="lazy" className={cn("object-contain", className)} />
  ) : (
    <div className={cn("grid place-items-center bg-muted text-xs text-muted-foreground", className)}>Sem imagem</div>
  );
}

export function ProductCard({ item }: { item: CatalogItemView }) {
  const [open, setOpen] = useState(false);
  const [favorite, setFavorite] = useState(item.isFavorite);
  const [hasOffer, setHasOffer] = useState(item.hasOffer);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleFavorite = () =>
    startTransition(async () => {
      setFavorite((f) => !f);
      const result = await toggleFavoriteAction(item.id);
      if ("error" in result) {
        setFavorite(item.isFavorite);
        setMessage({ ok: false, text: result.error });
      } else {
        setFavorite(result.favorite);
      }
    });

  const promote = () =>
    startTransition(async () => {
      const result = await promoteProductAction(item.id);
      if ("error" in result) setMessage({ ok: false, text: result.error });
      else {
        setHasOffer(true);
        setMessage({ ok: true, text: result.message });
      }
    });

  const favoriteButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleFavorite}
      disabled={pending}
      aria-pressed={favorite}
      aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
    >
      <HeartIcon className={cn(favorite && "fill-red-500 text-red-500")} />
    </Button>
  );

  const promoteButton = (
    <Button onClick={promote} disabled={pending} className="w-full" variant={hasOffer ? "outline" : "default"}>
      {hasOffer ? "Já está nas suas ofertas" : pending ? "Adicionando..." : "Divulgar este produto"}
    </Button>
  );

  return (
    <>
      <article className="flex flex-col overflow-hidden rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative block aspect-square bg-white"
          aria-label={`Ver detalhes de ${item.title}`}
        >
          <ProductImage item={item} className="size-full" />
          <span className="absolute top-2 left-2">
            <StoreBadge store={item.store} />
          </span>
          {item.discountPct ? (
            <span className="absolute top-2 right-2 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              -{item.discountPct}%
            </span>
          ) : null}
        </button>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <p className="text-xs text-muted-foreground">{CATEGORY_LABEL[item.category]}</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="line-clamp-2 text-left text-sm font-medium hover:underline"
          >
            {item.title}
          </button>
          <div className="mt-auto grid gap-1">
            <p className="text-lg font-semibold tabular-nums">{formatBRL(item.priceCents)}</p>
            <p className="text-xs text-muted-foreground">
              Comissão: <span className="font-medium text-foreground">{formatCommission(item.commissionCents, item.commissionPct)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            {promoteButton}
            {favoriteButton}
          </div>
          {message && !open ? (
            <p className={cn("text-xs", message.ok ? "text-green-700" : "text-destructive")} role="status">
              {message.text}
            </p>
          ) : null}
        </div>
      </article>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <StoreBadge store={item.store} />
              <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[item.category]}</span>
            </div>
            <DialogTitle className="text-left leading-snug">{item.title}</DialogTitle>
            <DialogDescription className="sr-only">Detalhes do produto do catálogo</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="aspect-square overflow-hidden rounded-lg border bg-white">
              <ProductImage item={item} className="size-full" />
            </div>
            <dl className="grid content-start gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Preço</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatBRL(item.priceCents)}</dd>
                {item.originalPriceCents ? (
                  <dd className="text-muted-foreground">
                    de <s>{formatBRL(item.originalPriceCents)}</s>
                    {item.discountPct ? <span className="ml-2 font-medium text-green-700">-{item.discountPct}%</span> : null}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-muted-foreground">Comissão</dt>
                <dd className="font-medium">{formatCommission(item.commissionCents, item.commissionPct)}</dd>
              </div>
              <div className="flex gap-6">
                <div>
                  <dt className="text-muted-foreground">Nota</dt>
                  <dd className="flex items-center gap-1 font-medium">
                    {item.rating === null ? (
                      "—"
                    ) : (
                      <>
                        <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                        {item.rating.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vendidos</dt>
                  <dd className="font-medium">{formatSold(item.soldCount)}</dd>
                </div>
              </div>
              <a
                href={item.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                Ver na loja
              </a>
              <div className="flex items-center gap-1">
                {promoteButton}
                {favoriteButton}
              </div>
              {message ? (
                <p className={cn("text-xs", message.ok ? "text-green-700" : "text-destructive")} role="status">
                  {message.text}
                </p>
              ) : null}
            </dl>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
