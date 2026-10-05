import { forTenant } from "@achadinhos/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/painel/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { formatBRL } from "@/lib/catalog";
import { HeadlineReport } from "@/components/relatorios/headline-report";
import { isSystemAdmin } from "@/lib/ml-vitrine";

export const metadata: Metadata = { title: "Relatórios — Achadinhos Bot" };

const DAY = 24 * 60 * 60_000;
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Status da Shopee -> grupo simples para o painel. */
function statusKind(status: string | null): "done" | "canceled" | "pending" {
  if (status && /complet|conclu|valid|paid_out/i.test(status)) return "done";
  if (status && /cancel|invalid|fraud|refund|return|unpaid/i.test(status)) return "canceled";
  return "pending";
}

const STORE_REPORTS = [
  {
    store: "MERCADO_LIVRE",
    title: "Mercado Livre: cliques e vendas",
    description:
      "Números do seu painel de afiliados do Mercado Livre, lidos pela extensão no seu Chrome de hora em hora (total da conta; o Mercado Livre separa por etiqueta, não por grupo).",
    login: "Chrome aberto e logado no Mercado Livre",
  },
  {
    store: "AMAZON",
    title: "Amazon: cliques e vendas",
    description:
      "Números do Relatórios do seu Associados da Amazon, lidos pela extensão no seu Chrome de hora em hora (total da conta, até ontem; a Amazon separa por etiqueta, não por grupo).",
    login: "Chrome aberto e logado no Associados da Amazon",
  },
] as const;

interface Totals {
  orders: number;
  amountCents: number;
  commissionCents: number;
  pendingCents: number;
  canceled: number;
}
const empty = (): Totals => ({ orders: 0, amountCents: 0, commissionCents: 0, pendingCents: 0, canceled: 0 });

export default async function RelatoriosPage() {
  const { user } = await requireSession();
  const db = forTenant(user.tenantId);
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const [conversions, groups, credential, snapshots, storeCredentials] = await Promise.all([
    db.conversion.findMany({
      where: { store: "SHOPEE", occurredAt: { gte: since30 } },
      select: { groupId: true, amountCents: true, commissionCents: true, status: true, occurredAt: true, updatedAt: true },
    }),
    db.group.findMany({ select: { id: true, name: true } }),
    db.storeCredential.findFirst({ where: { store: "SHOPEE" }, select: { id: true } }),
    db.storeReportSnapshot.findMany({ where: { store: { in: ["MERCADO_LIVRE", "AMAZON"] } }, orderBy: { rangeDays: "asc" } }),
    db.storeCredential.findMany({ where: { store: { in: ["MERCADO_LIVRE", "AMAZON"] } }, select: { store: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const lastSync = conversions.reduce<Date | null>((max, c) => (!max || c.updatedAt > max ? c.updatedAt : max), null);

  const summarize = (days: number) => {
    const since = now - days * DAY;
    const byGroup = new Map<string, Totals>();
    const total = empty();
    for (const c of conversions) {
      if (c.occurredAt.getTime() < since) continue;
      const key = c.groupId ?? "";
      const t = byGroup.get(key) ?? empty();
      for (const target of [t, total]) {
        const kind = statusKind(c.status);
        if (kind === "canceled") {
          target.canceled += 1;
          continue;
        }
        target.orders += 1;
        target.amountCents += c.amountCents;
        if (kind === "done") target.commissionCents += c.commissionCents;
        else target.pendingCents += c.commissionCents;
      }
      byGroup.set(key, t);
    }
    const rows = [...byGroup.entries()]
      .map(([groupId, t]) => ({ name: groupId ? (groupName.get(groupId) ?? "Grupo removido") : "Fora dos grupos (links divulgados por fora)", ...t }))
      .sort((a, b) => b.commissionCents + b.pendingCents - (a.commissionCents + a.pendingCents));
    return { total, rows };
  };

  return (
    <>
      <PageHeader title="Relatórios" description="Vendas e comissões das suas divulgações." />
      <div className="grid gap-4">
        {STORE_REPORTS.map((store) => {
          const list = snapshots.filter((x) => x.store === store.store);
          const hasCredential = storeCredentials.some((c) => c.store === store.store);
          return (
            <Card key={store.store}>
              <CardHeader>
                <CardTitle>{store.title}</CardTitle>
                <CardDescription>{store.description}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {list.length === 0 ? (
                  <p className="text-muted-foreground">
                    {hasCredential ? "Ainda sem leitura. " : `Configure a credencial da loja em Credenciais e `}
                    Ligue a extensão ao painel na página{" "}
                    <Link href="/painel/extensao" className="underline underline-offset-4">
                      Extensão
                    </Link>{" "}
                    ({store.login}).
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {list.map((s) => {
                      const conversion = s.clicks > 0 ? ((s.orders / s.clicks) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "0";
                      return (
                        <div key={s.id} className="grid gap-1 rounded-lg border p-3">
                          <p className="font-semibold">Últimos {s.rangeDays} dias</p>
                          <p>
                            <strong className="text-lg">{s.clicks}</strong> cliques ·{" "}
                            {store.store === "AMAZON"
                              ? `${s.orders} pedidos · ${s.units} enviados`
                              : `${s.buyers} compradores · ${s.orders} pedidos · ${s.units} unidades`}
                          </p>
                          <p>
                            Vendas {formatBRL(s.salesCents)} · {store.store === "AMAZON" ? "ganhos" : "ganho estimado"}{" "}
                            <strong>{formatBRL(s.commissionCents)}</strong>
                          </p>
                          <p className="text-muted-foreground">
                            Conversão {conversion}%
                            {s.notEffectiveSalesCents > 0
                              ? ` · ${store.store === "AMAZON" ? "devolvidos" : "não efetivadas"} ${formatBRL(s.notEffectiveSalesCents)}`
                              : ""}{" "}
                            · lido {dateTime.format(s.fetchedAt)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {[7, 30].map((days) => {
          const { total, rows } = summarize(days);
          return (
            <Card key={days}>
              <CardHeader>
                <CardTitle>Shopee: vendas por grupo (últimos {days} dias)</CardTitle>
                <CardDescription>
                  Dados oficiais do relatório de vendas da Shopee, ligados ao grupo pelo seu link. A Shopee não informa cliques
                  pela API, só vendas.
                  {lastSync ? ` Atualizado ${dateTime.format(lastSync)}.` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {!credential ? (
                  <p className="text-muted-foreground">
                    Configure a credencial da Shopee em{" "}
                    <Link href="/painel/credenciais" className="underline underline-offset-4">
                      Credenciais
                    </Link>{" "}
                    para ver as vendas.
                  </p>
                ) : rows.length === 0 ? (
                  <p className="text-muted-foreground">Nenhuma venda da Shopee pelos seus links neste período (o relatório atualiza de hora em hora).</p>
                ) : (
                  <>
                    <p>
                      <strong>{total.orders}</strong> {total.orders === 1 ? "pedido" : "pedidos"} · {formatBRL(total.amountCents)} em vendas ·
                      comissão <strong>{formatBRL(total.commissionCents)}</strong> confirmada
                      {total.pendingCents > 0 ? ` + ${formatBRL(total.pendingCents)} pendente` : ""}
                      {total.canceled > 0 ? ` · ${total.canceled} cancelado(s)` : ""}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="text-xs text-muted-foreground">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Grupo</th>
                            <th className="py-2 pr-3 font-medium">Pedidos</th>
                            <th className="py-2 pr-3 font-medium">Vendas</th>
                            <th className="py-2 pr-3 font-medium">Comissão confirmada</th>
                            <th className="py-2 pr-3 font-medium">Comissão pendente</th>
                            <th className="py-2 font-medium">Cancelados</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.name} className="border-t">
                              <td className="py-2 pr-3">{r.name}</td>
                              <td className="py-2 pr-3 tabular-nums">{r.orders}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatBRL(r.amountCents)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatBRL(r.commissionCents)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatBRL(r.pendingCents)}</td>
                              <td className="py-2 tabular-nums">{r.canceled}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
        {isSystemAdmin(user.email) ? <HeadlineReport /> : null}
      </div>
    </>
  );
}
