"use client";

import { SearchIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GroupFilters as Filters } from "@/lib/whatsapp";

/** Busca por nome + "só onde sou admin". Os filtros ficam na URL (?busca=...&todos=1). */
export function GroupFilters({ initial }: { initial: Filters }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(initial.search);
  const [onlyAdmin, setOnlyAdmin] = useState(initial.onlyAdmin);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Espera a pessoa parar de digitar antes de buscar.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("busca", search.trim());
      if (!onlyAdmin) params.set("todos", "1");
      const query = params.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, onlyAdmin, pathname, router]);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative w-full max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar grupo pelo nome"
          aria-label="Buscar grupo pelo nome"
          className="pl-8"
          maxLength={100}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="only-admin" checked={onlyAdmin} onCheckedChange={setOnlyAdmin} />
        <Label htmlFor="only-admin">Só grupos em que o número é admin</Label>
      </div>
      {pending ? <span className="text-xs text-muted-foreground">Filtrando...</span> : null}
    </div>
  );
}
