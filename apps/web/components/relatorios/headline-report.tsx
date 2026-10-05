// Relatório do ADMINISTRADOR: produtos do catálogo sem tipo no dicionário de headlines.
import { getPrisma, headlineCoverage } from "@achadinhos/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STORE_NAMES } from "@achadinhos/stores";
import { RecomputeHeadlinesButton } from "./recompute-headlines-button";

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 1000) / 10}%` : "0%");

function ProductList({ products }: { products: { id: string; title: string; store: string; category: string }[] }) {
  if (products.length === 0) return <p className="text-sm text-muted-foreground">Nenhum.</p>;
  return (
    <ul className="grid max-h-80 gap-1 overflow-y-auto text-sm">
      {products.map((p) => (
        <li key={p.id} className="border-t pt-1">
          {p.title}{" "}
          <span className="text-xs text-muted-foreground">
            ({STORE_NAMES[p.store as keyof typeof STORE_NAMES] ?? p.store} · {p.category})
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function HeadlineReport() {
  const c = await headlineCoverage(getPrisma());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Headlines do catálogo (só administrador)</CardTitle>
        <CardDescription>
          Produtos ativos por tipo do dicionário. Os da lista "genérica" não acharam tipo nem categoria: são candidatos a novos
          tipos no dicionário (packages/stores/src/headlines/dictionary.ts). Depois de mudar o dicionário, clique em Recalcular.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">
          {c.active} ativos · por tipo <strong>{c.byType}</strong> ({pct(c.byType, c.active)}) · só categoria{" "}
          <strong>{c.byCategory}</strong> ({pct(c.byCategory, c.active)}) · genérica <strong>{c.generic}</strong> (
          {pct(c.generic, c.active)}){c.missing > 0 ? ` · sem cálculo ${c.missing}` : ""}
        </p>
        <RecomputeHeadlinesButton />
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Genérica ({c.generic})</summary>
          <ProductList products={c.genericProducts} />
        </details>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Só categoria ({c.byCategory}, até 200 mostrados)</summary>
          <ProductList products={c.categoryProducts} />
        </details>
      </CardContent>
    </Card>
  );
}
