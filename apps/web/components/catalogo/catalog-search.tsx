"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import type { CatalogFilters } from "@achadinhos/db";
import { catalogHref } from "@/lib/catalog";

/** Busca por nome: atualiza a URL quando a pessoa para de digitar. */
export function CatalogSearch({ filters }: { filters: CatalogFilters }) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      startTransition(() => router.replace(catalogHref(filters, { search: search.trim() }), { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
    // filters muda junto com a URL; só a digitação dispara a busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="relative w-full max-w-xl">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar produto (ex.: fone bluetooth, ração, perfume)"
        aria-label="Buscar produto no catálogo"
        className="h-10 pl-9"
        maxLength={100}
      />
      {pending ? (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">Buscando...</span>
      ) : null}
    </div>
  );
}
