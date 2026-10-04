"use client";

import type { CatalogCategory, Store } from "@achadinhos/db";
import { HeartIcon, StarIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toggleFavoriteAction } from "@/app/painel/catalogo/actions";
import { previewCatalogProductAction, type SharePreview } from "@/app/painel/divulgar-link/actions";
import { SharePanel } from "@/components/divulgar/share-panel";
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

/** Link do cliente e mensagem: gerados quando o modal abre. */
function CatalogShare({ productId }: { productId: string }) {
  const [state, setState] = useState<{ preview: SharePreview } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void previewCatalogProductAction(productId).then((result) => {
      if (!cancelled) setState(result.ok ? { preview: result.preview } : { error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!state) return <p className="text-sm text-muted-foreground">Gerando seu link de afiliado...</p>;
  if ("error" in state) return <p className="text-sm text-destructive">{state.error}</p>;
  return <SharePanel preview={state.preview} editableInfo={false} />;
}

export function ProductCard({ item }: { item: CatalogItemView }) {
  const [open, setOpen] = useState(false);
  const [favorite, setFavorite] = useState(item.isFavorite);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleFavorite = () =>
    startTransition(async () => {
      setFavorite((f) => !f);
      const result = await toggleFavoriteAction(item.id);
      if ("error" in result) {
        setFavorite(item.isFavorite);
        setError(result.error);
      } else {
        setFavorite(result.favorite);
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
          <button type="button" onClick={() => setOpen(true)} className="line-clamp-2 text-left text-sm font-medium hover:underline">
            {item.title}
          </button>
          <div className="mt-auto grid gap-1">
            <p className="text-lg font-semibold tabular-nums">{formatBRL(item.priceCents)}</p>
            <p className="text-xs text-muted-foreground">
              Comissão: <span className="font-medium text-foreground">{formatCommission(item.commissionCents, item.commissionPct)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={() => setOpen(true)} className="w-full" variant={item.hasOffer ? "outline" : "default"}>
              {item.hasOffer ? "Divulgar de novo" : "Divulgar este produto"}
            </Button>
            {favoriteButton}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </article>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <StoreBadge store={item.store} />
              <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[item.category]}</span>
            </div>
            <DialogTitle className="text-left leading-snug">{item.title}</DialogTitle>
            <DialogDescription className="sr-only">Detalhes do produto, link de afiliado e mensagem pronta</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="grid content-start gap-4">
              <div className="aspect-square overflow-hidden rounded-lg border bg-white">
                <ProductImage item={item} className="size-full" />
              </div>
              <dl className="grid gap-3 text-sm">
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
                <div className="flex items-center gap-3">
                  <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">
                    Ver na loja
                  </a>
                  {favoriteButton}
                </div>
              </dl>
            </div>
            <div className="min-w-0">{open ? <CatalogShare productId={item.id} /> : null}</div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
