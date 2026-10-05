// Exportar CSV (fase 8, plano Agência): uma tabela do relatório, só com os dados do próprio tenant.
import { forTenant, getCurrentSubscription, planAllowsSending } from "@achadinhos/db";
import { getCurrentSession } from "@/lib/auth/current";
import { buildTable, canSee, loadReportData, parsePeriod, TABLE_KEYS, toCsv, type TableKey } from "@/lib/reports";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return text("Entre na sua conta.", 401);
  const { user } = session;
  const subscription = await getCurrentSubscription(user.tenantId);
  if (!subscription || !planAllowsSending(subscription.plan) || !canSee(subscription.plan.reportsLevel, "csv")) {
    return text("Exportar CSV não está disponível no seu plano.", 403);
  }

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const key = params.tabela;
  if (!key || !(TABLE_KEYS as readonly string[]).includes(key)) return text("Tabela inválida.", 400);

  const period = parsePeriod(params);
  const table = buildTable(key as TableKey, await loadReportData(forTenant(user.tenantId), period));
  const first = period.days[0] ?? "";
  const last = period.days[period.days.length - 1] ?? "";
  return new Response(toCsv(table), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="relatorio-${key}-${first}-a-${last}.csv"`,
      "cache-control": "no-store",
    },
  });
}
