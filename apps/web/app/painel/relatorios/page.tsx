import { forTenant, getCurrentSubscription, planAllowsSending, type ReportsLevel } from "@achadinhos/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/painel/page-header";
import { HeadlineReport } from "@/components/relatorios/headline-report";
import { CsvButton, DailyChart, Locked, PeriodFilter, SimpleTable } from "@/components/relatorios/report-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { formatBRL } from "@/lib/catalog";
import { isSystemAdmin } from "@/lib/ml-vitrine";
import { canSee, loadReportData, parsePeriod, planNameFor, storeLabel, type SalesTotals } from "@/lib/reports";
import { trackedLinksBase } from "@/lib/short-domain";

export const metadata: Metadata = { title: "Relatórios — Achadinhos Bot" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const decimal = (n: number, digits = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const ML_PORTAL_URL = "https://www.mercadolivre.com.br/afiliados/hub";
const AMAZON_PORTAL_URL = "https://associados.amazon.com.br/p/reporting/earnings";

const STORE_REPORTS = [
  {
    store: "MERCADO_LIVRE",
    title: "Mercado Livre: cliques e vendas da conta",
    description:
      "Números do painel de afiliados da conta do Mercado Livre logada no Chrome onde a SUA extensão está ligada ao painel (só a sua conta do painel recebe estes dados). Total da conta: o Mercado Livre separa por etiqueta, não por grupo.",
    login: "Chrome aberto e logado no Mercado Livre",
    notice: "Vendas do Mercado Livre por grupo e por oferta: consulte o seu portal de afiliados.",
    portal: ML_PORTAL_URL,
    portalLabel: "Abrir o portal de afiliados",
  },
  {
    store: "AMAZON",
    title: "Amazon: cliques e vendas da conta",
    description:
      "Números do Relatórios do Associados, lidos pela sua extensão só quando a conta logada tem a mesma etiqueta das suas Credenciais. Total da conta, até ontem: a Amazon separa por etiqueta, não por grupo.",
    login: "Chrome aberto e logado no Associados da Amazon",
    notice: "Vendas da Amazon por grupo e por oferta: consulte o seu Associados.",
    portal: AMAZON_PORTAL_URL,
    portalLabel: "Abrir o Associados",
  },
] as const;

const salesCells = (t: SalesTotals) => [t.orders, formatBRL(t.amountCents), formatBRL(t.commissionCents), formatBRL(t.pendingCents), t.canceled];
const SALES_HEADERS = ["Pedidos", "Vendas", "Comissão confirmada", "Comissão pendente", "Cancelados"];

/** Plano Catálogo: convite para o Iniciante, explicando o que cada plano libera. */
function Invite() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatórios fazem parte dos planos com envio aos grupos</CardTitle>
        <CardDescription>
          No plano Catálogo você copia as mensagens e divulga por fora. Com o plano {planNameFor("daily")} o painel envia aos
          seus grupos e passa a acompanhar os resultados.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="grid gap-1">
          <li>
            <strong>{planNameFor("daily")}:</strong> cliques por dia e por loja, vendas e comissão da Shopee por grupo, números
            do Mercado Livre e da Amazon da sua conta.
          </li>
          <li>
            <strong>{planNameFor("groups")}:</strong> + cliques e taxa de cliques por grupo, cliques por oferta e as ofertas que
            mais venderam.
          </li>
          <li>
            <strong>{planNameFor("csv")}:</strong> tudo isso + exportar as tabelas em CSV (Excel).
          </li>
        </ul>
        <Button render={<Link href="/painel/configuracoes#plano" />} nativeButton={false} className="w-fit">
          Conhecer o plano {planNameFor("daily")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireSession();
  const subscription = await getCurrentSubscription(user.tenantId);
  const admin = isSystemAdmin(user.email);

  if (!subscription || !planAllowsSending(subscription.plan)) {
    return (
      <>
        <PageHeader title="Relatórios" description="Cliques, vendas e comissões das suas divulgações." />
        <div className="grid gap-4">
          <Invite />
          {admin ? <HeadlineReport /> : null}
        </div>
      </>
    );
  }

  const level: ReportsLevel = subscription.plan.reportsLevel;
  const period = parsePeriod(await searchParams);
  const db = forTenant(user.tenantId);
  const [data, autopilot, shopeeCredential, snapshots, storeCredentials] = await Promise.all([
    loadReportData(db, period),
    db.autopilotSettings.findUnique({ where: { tenantId: user.tenantId }, select: { trackClicks: true } }),
    db.storeCredential.findFirst({ where: { store: "SHOPEE" }, select: { id: true } }),
    db.storeReportSnapshot.findMany({ where: { store: { in: ["MERCADO_LIVRE", "AMAZON"] } }, orderBy: { rangeDays: "asc" } }),
    db.storeCredential.findMany({ where: { store: { in: ["MERCADO_LIVRE", "AMAZON"] } }, select: { store: true } }),
  ]);
  const csv = canSee(level, "csv");
  const trackingOn = Boolean(trackedLinksBase() && autopilot?.trackClicks);
  const showClicks = trackingOn || data.clicks.total > 0;

  return (
    <>
      <PageHeader title="Relatórios" description="Cliques, vendas e comissões das suas divulgações." />
      <div className="grid gap-4">
        <PeriodFilter period={period} />

        {/* ---------- Cliques ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Cliques nos seus links</CardTitle>
            <CardDescription>
              Contados pelo nosso link curto das mensagens enviadas aos grupos (robôs de pré-visualização e cliques repetidos
              da mesma pessoa em 30 minutos não contam).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {!showClicks ? (
              trackedLinksBase() ? (
                <div className="grid gap-2">
                  <p className="text-muted-foreground">
                    Hoje as suas mensagens levam o link curto da própria loja, e a Shopee, o Mercado Livre e a Amazon não
                    informam os cliques por grupo. Para ver cliques por dia, grupo, loja e oferta, ligue &quot;Contar cliques
                    por grupo&quot;.
                  </p>
                  <Button render={<Link href="/painel/configuracoes#cliques" />} nativeButton={false} size="sm" variant="outline" className="w-fit">
                    Ligar em Configurações
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">A contagem de cliques ainda não está disponível. Por enquanto, veja as vendas abaixo.</p>
              )
            ) : (
              <>
                {!trackingOn ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    &quot;Contar cliques por grupo&quot; está desligado: os cliques abaixo são de mensagens enviadas antes.
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <strong className="text-2xl">{data.clicks.total}</strong> {data.clicks.total === 1 ? "clique" : "cliques"} no
                    período
                  </p>
                  <CsvButton table="dias" period={period} allowed={csv} />
                </div>
                <DailyChart data={data.clicks.byDay} />

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Por loja</h3>
                      <CsvButton table="lojas" period={period} allowed={csv} />
                    </div>
                    <SimpleTable
                      headers={["Loja", "Cliques"]}
                      rows={data.clicks.byStore.map((s) => [storeLabel(s.store), s.clicks])}
                      empty="Nenhum clique no período."
                    />
                  </div>
                  <div className="grid content-start gap-2">
                    {canSee(level, "groups") ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold">Por grupo</h3>
                          <CsvButton table="grupos" period={period} allowed={csv} />
                        </div>
                        <SimpleTable
                          headers={["Grupo", "Cliques"]}
                          rows={data.clicks.byGroup.map((g) => [g.name, g.clicks])}
                          empty="Nenhum clique no período."
                        />
                      </>
                    ) : (
                      <Locked feature="groups" what="Cliques por grupo" />
                    )}
                  </div>
                </div>

                {canSee(level, "offers") ? (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Por oferta</h3>
                      <CsvButton table="ofertas-cliques" period={period} allowed={csv} />
                    </div>
                    <SimpleTable
                      headers={["Oferta", "Loja", "Cliques"]}
                      rows={data.clicks.byOffer.slice(0, 50).map((o) => [o.title, storeLabel(o.store), o.clicks])}
                      empty="Nenhum clique no período."
                    />
                  </div>
                ) : (
                  <Locked feature="offers" what="Cliques por oferta" />
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ---------- Taxa de cliques por grupo ---------- */}
        {showClicks ? (
          canSee(level, "groups") ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1.5">
                    <CardTitle>Taxa de cliques por grupo</CardTitle>
                    <CardDescription>Mensagens enviadas pelo painel no período e quantos cliques elas tiveram.</CardDescription>
                  </div>
                  <CsvButton table="taxa" period={period} allowed={csv} />
                </div>
              </CardHeader>
              <CardContent className="grid gap-2">
                <SimpleTable
                  headers={["Grupo", "Mensagens", "Cliques", "Cliques por mensagem", "Membros", "% dos membros"]}
                  rows={data.rates.map((r) => [
                    r.name,
                    r.messages,
                    r.clicks,
                    r.clicksPerMessage === null ? "—" : decimal(r.clicksPerMessage, 2),
                    r.members ?? "—",
                    r.pctMembers === null ? (
                      "—"
                    ) : (
                      <abbr
                        key="pct"
                        className="cursor-help no-underline"
                        title="Aproximado: cliques ÷ (mensagens × membros). A mesma pessoa pode clicar mais de uma vez (em horários diferentes) e o número de membros muda com o tempo."
                      >
                        ≈ {decimal(r.pctMembers, 1)}%
                      </abbr>
                    ),
                  ])}
                  empty="Nenhuma mensagem enviada aos grupos no período."
                />
                <p className="text-xs text-muted-foreground">
                  ≈ % dos membros é aproximado: cliques ÷ (mensagens × membros do grupo). A mesma pessoa pode clicar mais de uma
                  vez em horários diferentes, e o número de membros muda com o tempo.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Locked feature="groups" what="Taxa de cliques por grupo" />
          )
        ) : null}

        {/* ---------- Shopee: vendas por grupo ---------- */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="grid gap-1.5">
                <CardTitle>Shopee: vendas por grupo</CardTitle>
                <CardDescription>
                  Relatório oficial de vendas da Shopee, ligado ao grupo pelo seu link (subIds). Atualiza de hora em hora.
                  {data.shopee.lastSync ? ` Atualizado em ${dateTime.format(data.shopee.lastSync)}.` : ""}
                </CardDescription>
              </div>
              {shopeeCredential ? <CsvButton table="vendas-grupos" period={period} allowed={csv} /> : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {!shopeeCredential ? (
              <p className="text-muted-foreground">
                Configure a credencial da Shopee em{" "}
                <Link href="/painel/credenciais" className="underline underline-offset-4">
                  Credenciais
                </Link>{" "}
                para ver as vendas.
              </p>
            ) : (
              <>
                <p>
                  <strong>{data.shopee.total.orders}</strong> pedidos · vendas {formatBRL(data.shopee.total.amountCents)} · comissão{" "}
                  <strong>{formatBRL(data.shopee.total.commissionCents)}</strong> confirmada
                  {data.shopee.total.pendingCents > 0 ? ` + ${formatBRL(data.shopee.total.pendingCents)} pendente` : ""}
                  {data.shopee.total.canceled > 0 ? ` · ${data.shopee.total.canceled} cancelado(s)` : ""}
                </p>
                <SimpleTable
                  headers={["Grupo", ...SALES_HEADERS]}
                  rows={data.shopee.byGroup.map((g) => [g.name, ...salesCells(g)])}
                  empty="Nenhuma venda da Shopee pelos seus links neste período."
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* ---------- Ofertas que mais venderam ---------- */}
        {canSee(level, "offers") ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1.5">
                  <CardTitle>Ofertas que mais venderam</CardTitle>
                  <CardDescription>
                    Vendas ligadas à oferta pela loja (hoje só a Shopee informa o produto vendido). Ordem: comissão confirmada
                    + pendente.
                  </CardDescription>
                </div>
                <CsvButton table="ofertas-vendas" period={period} allowed={csv} />
              </div>
            </CardHeader>
            <CardContent>
              <SimpleTable
                headers={["Oferta", "Loja", "Cliques", ...SALES_HEADERS]}
                rows={data.topOffers.slice(0, 50).map((o) => [o.title, storeLabel(o.store), showClicks ? o.clicks : "—", ...salesCells(o)])}
                empty="Nenhuma venda ligada a uma oferta neste período."
              />
            </CardContent>
          </Card>
        ) : (
          <Locked feature="offers" what="Ofertas que mais venderam" />
        )}

        {/* ---------- Mercado Livre e Amazon (total da conta, pela extensão) ---------- */}
        {STORE_REPORTS.map((store) => {
          const list = snapshots.filter((x) => x.store === store.store);
          const hasCredential = storeCredentials.some((c) => c.store === store.store);
          const updatedAt = list.reduce<Date | null>((max, s) => (!max || s.fetchedAt > max ? s.fetchedAt : max), null);
          return (
            <Card key={store.store}>
              <CardHeader>
                <CardTitle>{store.title}</CardTitle>
                <CardDescription>
                  {store.description}
                  {updatedAt ? ` Atualizado em ${dateTime.format(updatedAt)}.` : ""}
                </CardDescription>
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
                      const conversion = s.clicks > 0 ? decimal((s.orders / s.clicks) * 100, 2) : "0";
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
                              : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-muted-foreground">
                  {store.notice}{" "}
                  <a href={store.portal} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {store.portalLabel}
                  </a>
                </p>
              </CardContent>
            </Card>
          );
        })}

        {admin ? <HeadlineReport /> : null}
      </div>
    </>
  );
}
