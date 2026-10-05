// Peças da página Relatórios (servidor): período, bloqueio por plano, gráfico, tabela e CSV.
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS, planNameFor, type ReportFeature, type ReportPeriod, type TableKey } from "@/lib/reports";

const BASE = "/painel/relatorios";

export function PeriodFilter({ period }: { period: ReportPeriod }) {
  const first = period.days[0] ?? "";
  const last = period.days[period.days.length - 1] ?? "";
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      {PERIOD_PRESETS.map((days) => (
        <Button
          key={days}
          render={<Link href={`${BASE}?periodo=${days}`} />}
          nativeButton={false}
          size="sm"
          variant={period.preset === days ? "default" : "outline"}
        >
          {days} dias
        </Button>
      ))}
      {/* Formulário GET: funciona sem JavaScript. */}
      <form action={BASE} method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          De
          <Input type="date" name="de" defaultValue={first} required className="h-8 w-auto" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Até
          <Input type="date" name="ate" defaultValue={last} required className="h-8 w-auto" />
        </label>
        <Button type="submit" size="sm" variant={period.preset === null ? "default" : "outline"}>
          Ver período
        </Button>
      </form>
      <p className="w-full text-xs text-muted-foreground">Período: {period.label} (horário de Brasília).</p>
    </div>
  );
}

/** Item bloqueado pelo plano: diz qual plano libera. */
export function Locked({ feature, what }: { feature: ReportFeature; what: string }) {
  const plan = planNameFor(feature);
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-4 text-sm">
      <p>
        <strong>{what}</strong>: disponível no plano <strong>{plan}</strong>.
      </p>
      <Button render={<Link href="/painel/configuracoes#plano" />} nativeButton={false} size="sm" variant="outline" className="w-fit">
        Ver o plano {plan}
      </Button>
    </div>
  );
}

/** Botão "Exportar CSV" (plano Agência) ou o nome do plano que libera. */
export function CsvButton({ table, period, allowed }: { table: TableKey; period: ReportPeriod; allowed: boolean }) {
  if (!allowed) {
    return (
      <span className="text-xs text-muted-foreground">
        Exportar CSV: plano{" "}
        <Link href="/painel/configuracoes#plano" className="underline underline-offset-4">
          {planNameFor("csv")}
        </Link>
      </span>
    );
  }
  const query = new URLSearchParams({ tabela: table, ...period.query });
  return (
    <Button render={<a href={`${BASE}/exportar?${query}`} />} nativeButton={false} size="sm" variant="outline">
      <DownloadIcon /> Exportar CSV
    </Button>
  );
}

export function SimpleTable({ headers, rows, empty }: { headers: ReactNode[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="py-2 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "py-2 pr-3" : "py-2 pr-3 tabular-nums"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dayLabel = (key: string) => key.slice(8, 10) + "/" + key.slice(5, 7);

/** Barras por dia (sem biblioteca de gráfico). */
export function DailyChart({ data }: { data: { day: string; clicks: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.clicks));
  const step = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div className="grid gap-1" role="img" aria-label="Cliques por dia">
      <div className="flex h-32 items-end gap-px">
        {data.map((d) => (
          <div
            key={d.day}
            title={`${dayLabel(d.day)}: ${d.clicks} ${d.clicks === 1 ? "clique" : "cliques"}`}
            className="min-w-0 flex-1 rounded-t-sm bg-primary/80"
            style={{ height: `${(d.clicks / max) * 100}%`, minHeight: d.clicks > 0 ? 2 : 0 }}
          />
        ))}
      </div>
      <div className="flex gap-px text-[10px] text-muted-foreground">
        {data.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % step === 0 ? dayLabel(d.day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
