import { getLatestMiningRuns, getPrisma, listCatalog } from "@achadinhos/db";
import { HeartIcon, LayoutGridIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CatalogSearch } from "@/components/catalogo/catalog-search";
import { ProductCard } from "@/components/catalogo/product-card";
import { PageHeader } from "@/components/painel/page-header";
import { requireSession } from "@/lib/auth/current";
import { CATALOG_STORES, CATEGORIES, catalogHref, parseCatalogFilters } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Catálogo — Achadinhos Bot" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const filters = parseCatalogFilters(await searchParams);
  const [catalog, runs] = await Promise.all([listCatalog(user.tenantId, filters), getLatestMiningRuns(getPrisma())]);
  const lastSuccess = runs.filter((r) => r?.status === "SUCCESS").map((r) => r!.finishedAt ?? r!.startedAt);
  const updatedAt = lastSuccess.sort((a, b) => b.getTime() - a.getTime())[0];
  const anyFilter = Boolean(filters.search || filters.category || filters.store || filters.favoritesOnly);

  return (
    <>
      <PageHeader
        title="Catálogo"
        description={
          updatedAt
            ? `Produtos em destaque nas lojas, atualizados automaticamente. Última atualização: ${dateTime.format(updatedAt)}.`
            : "Produtos em destaque nas lojas, atualizados automaticamente."
        }
      />

      <div className="grid gap-6">
        <CatalogSearch filters={filters} />

        {/* Categorias em círculos */}
        <nav aria-label="Categorias" className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
          {[{ value: null, label: "Todas", icon: LayoutGridIcon }, ...CATEGORIES].map((c) => {
            const active = filters.category === c.value;
            return (
              <Link
                key={c.label}
                href={catalogHref(filters, { category: c.value })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
              >
                <span
                  className={cn(
                    "grid size-14 place-items-center rounded-full border transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70",
                  )}
                >
                  <c.icon className="size-6" />
                </span>
                <span className={cn("text-xs leading-tight", active && "font-semibold")}>{c.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Lojas e favoritos */}
        <div className="flex flex-wrap gap-2">
          <Chip href={catalogHref(filters, { store: null })} active={filters.store === null && !filters.favoritesOnly}>
            Todas as lojas
          </Chip>
          {CATALOG_STORES.map((s) =>
            s.href ? (
              <Chip key={s.value} href={s.href} active={false}>
                {s.label} <span className="text-xs text-muted-foreground">· divulgar por link</span>
              </Chip>
            ) : (
              <Chip key={s.value} href={catalogHref(filters, { store: filters.store === s.value ? null : s.value })} active={filters.store === s.value}>
                {s.label}
              </Chip>
            ),
          )}
          <Chip href={catalogHref(filters, { favoritesOnly: !filters.favoritesOnly })} active={filters.favoritesOnly}>
            <HeartIcon className={cn("size-4", filters.favoritesOnly && "fill-current")} /> Meus favoritos
          </Chip>
        </div>

        <p className="text-sm text-muted-foreground">
          {catalog.total} produto(s){anyFilter ? " com esses filtros" : ""}.
        </p>

        {catalog.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {filters.favoritesOnly
              ? "Você ainda não favoritou produtos. Toque no coração de um produto para guardar aqui."
              : anyFilter
                ? "Nenhum produto com esses filtros."
                : "O catálogo ainda está sendo montado. A mineração das lojas roda automaticamente a cada hora."}
            {anyFilter ? (
              <>
                {" "}
                <Link href="/painel/catalogo" className="underline underline-offset-4">
                  Limpar filtros
                </Link>
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {catalog.items.map((item) => (
              <ProductCard
                key={item.id}
                item={{
                  id: item.id,
                  store: item.store,
                  title: item.title,
                  imageUrl: item.imageUrl,
                  productUrl: item.productUrl,
                  category: item.category,
                  priceCents: item.priceCents,
                  originalPriceCents: item.originalPriceCents,
                  discountPct: item.discountPct,
                  commissionPct: item.commissionPct,
                  commissionCents: item.commissionCents,
                  rating: item.rating,
                  soldCount: item.soldCount,
                  isFavorite: item.isFavorite,
                  hasOffer: item.hasOffer,
                }}
              />
            ))}
          </div>
        )}

        {catalog.pages > 1 ? (
          <nav aria-label="Paginação" className="flex items-center justify-center gap-3 text-sm">
            {catalog.page > 1 ? (
              <Link href={catalogHref(filters, { page: catalog.page - 1 })} className="rounded-md border px-3 py-1.5 hover:bg-muted">
                Anterior
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              Página {catalog.page} de {catalog.pages}
            </span>
            {catalog.page < catalog.pages ? (
              <Link href={catalogHref(filters, { page: catalog.page + 1 })} className="rounded-md border px-3 py-1.5 hover:bg-muted">
                Próxima
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
