import { formatMinute, WARMUP_DAYS } from "@achadinhos/db";
import { STORE_NAMES, type AffiliateStore } from "@achadinhos/stores";
import type { Metadata } from "next";
import Link from "next/link";
import type { AutopilotSettingsInput } from "@/app/painel/agendamento/actions";
import { AutopilotForm } from "@/components/agendamento/autopilot-form";
import { AutoRefresh, ChannelPauseButton, DevPickNowButton, ResumeStoreButton } from "@/components/agendamento/controls";
import { PageHeader } from "@/components/painel/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { loadAutopilotOverview, POST_STATUS_LABEL } from "@/lib/autopilot-panel";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "Agendamento — Achadinhos Bot" };

const TZ = "America/Sao_Paulo";
const time = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: TZ });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

const storeName = (store: string) => STORE_NAMES[store as AffiliateStore] ?? store;

/** "hoje às 14h05", "ontem às 22h00" ou "03/10 às 09h12". */
function when(date: Date, now: Date): string {
  const t = time.format(date).replace(":", "h");
  const diffDays = Math.round((Date.parse(dayKey.format(now)) - Date.parse(dayKey.format(date))) / 86_400_000);
  if (diffDays === 0) return `hoje às ${t}`;
  if (diffDays === 1) return `ontem às ${t}`;
  return `${dateTime.format(date).split(" ")[0]} às ${t}`;
}

const TONE: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  ok: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export default async function AgendamentoPage() {
  const { user } = await requireSession();
  const now = new Date();
  const o = await loadAutopilotOverview(user.tenantId, now);
  const s = o.settings;
  const pausedStores = o.credentials.filter((c) => c.autopilotPausedAt);

  return (
    <>
      <PageHeader title="Agendamento" description="Piloto automático e fila de envios para os seus grupos." />
      <AutoRefresh everyMs={o.devFast ? 5_000 : 15_000} />

      <div className="grid gap-4">
        {o.devFast ? (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                <strong>Modo acelerado (só desenvolvimento):</strong> o worker verifica a cada 5 s, escolhe uma oferta a cada 2
                min e espera 5 a 10 s entre grupos.
              </span>
              <DevPickNowButton />
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Resumo do dia */}
        <Card>
          <CardHeader>
            <CardTitle>Hoje</CardTitle>
            <CardDescription>
              {s.enabled
                ? `Piloto automático ligado: ${s.weekdays.length === 7 ? "todos os dias" : `${s.weekdays.length} dias por semana`}, das ${formatMinute(s.windowStartMinute)} às ${formatMinute(Math.min(s.windowEndMinute, 1439))}, até ${s.offersPerHour} ${s.offersPerHour === 1 ? "oferta" : "ofertas"} por hora.`
                : "Piloto automático desligado. As ofertas do botão \"Enviar para meus grupos\" continuam saindo pela fila."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <p className="text-2xl font-semibold">
              {o.offersToday} de {o.plan.maxOffersPerDay} <span className="text-base font-normal text-muted-foreground">ofertas hoje (plano {o.plan.name})</span>
            </p>
            {o.channels.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhum número de WhatsApp. <Link href="/painel/canais" className="underline underline-offset-4">Conectar um número</Link>
              </p>
            ) : (
              <ul className="grid gap-3">
                {o.channels.map((c) => (
                  <li key={c.id} className="grid gap-1 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {formatPhone(c.externalId) || c.name}{" "}
                        <span className="font-normal text-muted-foreground">· {c.groups} grupo(s) recebendo</span>
                      </span>
                      <ChannelPauseButton channelId={c.id} paused={c.paused} />
                    </div>
                    <span>
                      {c.warmupDay !== null
                        ? `Número em aquecimento (dia ${c.warmupDay} de ${WARMUP_DAYS}): ${c.messagesToday} de ${c.dailyLimit} mensagens hoje.`
                        : `${c.messagesToday} de ${c.dailyLimit} mensagens hoje.`}
                    </span>
                    {c.status !== "CONNECTED" ? <span className="text-destructive">Número desconectado: os envios esperam a reconexão.</span> : null}
                    {c.paused ? <span className="text-amber-700 dark:text-amber-400">Pausado. {c.pauseReason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Lojas: frescor do catálogo e pausas */}
        <Card>
          <CardHeader>
            <CardTitle>Lojas</CardTitle>
            <CardDescription>
              O piloto só escolhe produtos com preço atualizado nas últimas {o.maxAgeHours} horas.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {o.freshness.map((f) => (
              <p key={f.store} className={f.stale && o.allowedStores.includes(f.store) ? "text-amber-700 dark:text-amber-400" : ""}>
                <strong>{storeName(f.store)}:</strong>{" "}
                {f.at ? `última atualização ${when(f.at, now)}.` : "ainda sem atualização."}
                {f.stale && o.allowedStores.includes(f.store)
                  ? ` ${storeName(f.store)} sem atualização ${f.at ? `desde ${when(f.at, now)}` : "ainda"}; o piloto não vai postar produtos dela até atualizar.`
                  : ""}
                {!o.allowedStores.includes(f.store) ? " (fora do piloto automático)" : ""}
              </p>
            ))}
            {pausedStores.map((c) => (
              <div key={c.store} className="flex flex-wrap items-center gap-2 text-amber-700 dark:text-amber-400">
                <span>{c.lastError ?? `${storeName(c.store)} pausada no piloto automático.`}</span>
                <Link href="/painel/credenciais" className="underline underline-offset-4">Corrigir credencial</Link>
                <ResumeStoreButton store={c.store} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Configuração */}
        <Card>
          <CardHeader>
            <CardTitle>Piloto automático</CardTitle>
            <CardDescription>
              Escolhe sozinho os melhores produtos do catálogo, gera o seu link de afiliado e posta nos grupos, com intervalo
              entre os envios.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AutopilotForm
              initial={{
                enabled: s.enabled,
                weekdays: s.weekdays,
                windowStartMinute: s.windowStartMinute,
                windowEndMinute: s.windowEndMinute,
                offersPerHour: s.offersPerHour,
                stores: s.stores.filter((x): x is "SHOPEE" | "AMAZON" | "MERCADO_LIVRE" => ["SHOPEE", "AMAZON", "MERCADO_LIVRE"].includes(x)),
                categories: s.categories.filter((c) => c !== "OTHER") as AutopilotSettingsInput["categories"],
                minDiscountPct: s.minDiscountPct,
                minPriceCents: s.minPriceCents,
                maxPriceCents: s.maxPriceCents,
                minRating: s.minRating,
                minCommissionPct: s.minCommissionPct,
                groupIds: s.groupIds,
                repeatDays: s.repeatDays,
                groupIntervalMinSeconds: s.groupIntervalMinSeconds,
                groupIntervalMaxSeconds: s.groupIntervalMaxSeconds,
                channelDailyLimit: s.channelDailyLimit,
              }}
              groups={o.groups}
              allowedStores={o.allowedStores}
            />
          </CardContent>
        </Card>

        {/* Fila */}
        <Card>
          <CardHeader>
            <CardTitle>Fila de envios</CardTitle>
            <CardDescription>Posts de hoje e os que estão esperando (atualiza sozinha).</CardDescription>
          </CardHeader>
          <CardContent>
            {o.queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada na fila hoje.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Produto</th>
                      <th className="py-2 pr-3 font-medium">Grupo</th>
                      <th className="py-2 pr-3 font-medium">Horário</th>
                      <th className="py-2 font-medium">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.queue.map((p) => {
                      const status = POST_STATUS_LABEL[p.status];
                      return (
                        <tr key={p.id} className="border-t align-top">
                          <td className="py-2 pr-3">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TONE[status.tone])}>{status.label}</span>
                          </td>
                          <td className="max-w-72 py-2 pr-3">
                            <span className="line-clamp-2">{p.offer.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.store ? storeName(p.store) : ""} · {p.source === "AUTO" ? "piloto" : "manual"}
                            </span>
                          </td>
                          <td className="py-2 pr-3">{p.group.name}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {p.sentAt ? `enviado ${when(p.sentAt, now)}` : p.scheduledAt ? `previsto ${when(p.scheduledAt, now)}` : "—"}
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {p.error ??
                              (p.status === "AWAITING_LINK"
                                ? "Esperando a extensão gerar o link curto (Chrome aberto e ligado ao piloto em Extensão)."
                                : p.attempts > 1
                                  ? `${p.attempts} tentativas`
                                  : "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Badge variant="outline" className="w-fit">Horários de Brasília</Badge>
      </div>
    </>
  );
}
