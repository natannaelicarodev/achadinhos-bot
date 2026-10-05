"use client";

import { formatMinute, maxOffersPerHour, type Store } from "@achadinhos/db/autopilot";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveAutopilotSettingsAction, type AutopilotSettingsInput } from "@/app/painel/agendamento/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES } from "@/lib/catalog";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
type AutopilotStore = AutopilotSettingsInput["stores"][number];
const STORES: { value: AutopilotStore; label: string }[] = [
  { value: "SHOPEE", label: "Shopee" },
  { value: "AMAZON", label: "Amazon" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre" },
];

interface GroupOption {
  id: string;
  name: string;
  channelId: string;
  postingEnabled: boolean;
  canSend: boolean;
}

const toTime = (minute: number) => formatMinute(Math.min(minute, 24 * 60 - 1));
const fromTime = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const reaisToCents = (v: string) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const centsToReais = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));
const numOrNull = (v: string) => {
  const n = Number(v.replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function AutopilotForm({
  initial,
  groups,
  allowedStores,
}: {
  initial: AutopilotSettingsInput;
  groups: GroupOption[];
  allowedStores: Store[];
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [minPrice, setMinPrice] = useState(centsToReais(initial.minPriceCents ?? null));
  const [maxPrice, setMaxPrice] = useState(centsToReais(initial.maxPriceCents ?? null));
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof AutopilotSettingsInput>(key: K, value: AutopilotSettingsInput[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const sendable = groups.filter((g) => g.canSend);
  const chooseGroups = s.groupIds.length > 0;
  const targets = chooseGroups ? sendable.filter((g) => s.groupIds.includes(g.id)) : sendable.filter((g) => g.postingEnabled);
  const fit = useMemo(() => {
    const perChannel = new Map<string, number>();
    for (const g of targets) perChannel.set(g.channelId, (perChannel.get(g.channelId) ?? 0) + 1);
    const maxGroups = Math.max(0, ...perChannel.values());
    return { maxGroups, max: maxOffersPerHour(maxGroups, s.groupIntervalMaxSeconds) };
  }, [targets, s.groupIntervalMaxSeconds]);
  const tooMany = s.offersPerHour > fit.max;

  const save = () =>
    startTransition(async () => {
      const result = await saveAutopilotSettingsAction({ ...s, minPriceCents: reaisToCents(minPrice), maxPriceCents: reaisToCents(maxPrice) });
      setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    });

  return (
    <div className="grid gap-6 text-sm">
      <label className="flex items-center gap-3">
        <Switch checked={s.enabled} onCheckedChange={(v) => set("enabled", v)} />
        <span className="font-medium">{s.enabled ? "Piloto automático ligado" : "Piloto automático desligado"}</span>
      </label>

      {/* Quando */}
      <section className="grid gap-3">
        <h3 className="font-semibold">Quando postar (horário de Brasília)</h3>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((label, day) => (
            <label key={label} className="flex items-center gap-1.5 rounded-md border px-2 py-1">
              <input type="checkbox" checked={s.weekdays.includes(day)} onChange={() => set("weekdays", toggle(s.weekdays, day).sort())} />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="ap-start">Das</Label>
            <Input id="ap-start" type="time" value={toTime(s.windowStartMinute)} onChange={(e) => set("windowStartMinute", fromTime(e.target.value))} className="w-32" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-end">Até</Label>
            <Input
              id="ap-end"
              type="time"
              value={toTime(s.windowEndMinute)}
              onChange={(e) => set("windowEndMinute", e.target.value === "23:59" ? 24 * 60 : fromTime(e.target.value))}
              className="w-32"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-rate">Ofertas por hora</Label>
            <Input id="ap-rate" type="number" min={1} max={12} value={s.offersPerHour} onChange={(e) => set("offersPerHour", Number(e.target.value) || 1)} className="w-28" />
          </div>
        </div>
        <p className={tooMany ? "text-destructive" : "text-muted-foreground"}>
          {fit.maxGroups > 0
            ? `Com ${fit.maxGroups} ${fit.maxGroups === 1 ? "grupo" : "grupos"} no mesmo número, o máximo é ${fit.max} ${fit.max === 1 ? "oferta" : "ofertas"} por hora.`
            : "Nenhum grupo vai receber: ligue \"Postar neste grupo\" em Canais ou escolha os grupos abaixo."}
          {tooMany ? " Diminua as ofertas por hora para salvar." : ""}
        </p>
      </section>

      {/* Filtros */}
      <section className="grid gap-3">
        <h3 className="font-semibold">Quais produtos</h3>
        <div className="grid gap-1.5">
          <span>Lojas (nenhuma marcada = todas as permitidas)</span>
          <div className="flex flex-wrap gap-2">
            {STORES.map((store) => {
              const allowed = allowedStores.includes(store.value);
              return (
                <label key={store.value} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${allowed ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={allowed && s.stores.includes(store.value)}
                    onChange={() => set("stores", toggle(s.stores, store.value))}
                  />
                  {store.label}
                </label>
              );
            })}
          </div>
          {!allowedStores.includes("MERCADO_LIVRE") ? (
            <p className="text-xs text-muted-foreground">
              Mercado Livre fica fora do piloto automático por enquanto: o link curto meli.la depende da extensão no seu
              navegador, e o link gerado no servidor ainda está em confirmação. Continue divulgando o ML pelo catálogo ou pelo
              Divulgar link (modo manual).
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <span>Categorias (nenhuma marcada = todas)</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <label key={c.value} className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                <input type="checkbox" checked={s.categories.includes(c.value)} onChange={() => set("categories", toggle(s.categories, c.value))} />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label htmlFor="ap-discount">Desconto mínimo (%)</Label>
            <Input id="ap-discount" inputMode="numeric" value={s.minDiscountPct ?? ""} onChange={(e) => set("minDiscountPct", numOrNull(e.target.value))} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-min">Preço mínimo (R$)</Label>
            <Input id="ap-min" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-max">Preço máximo (R$)</Label>
            <Input id="ap-max" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-rating">Nota mínima (0 a 5)</Label>
            <Input id="ap-rating" inputMode="decimal" value={s.minRating ?? ""} onChange={(e) => set("minRating", numOrNull(e.target.value))} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-commission">Comissão mínima (%)</Label>
            <Input id="ap-commission" inputMode="decimal" value={s.minCommissionPct ?? ""} onChange={(e) => set("minCommissionPct", numOrNull(e.target.value))} className="w-36" />
          </div>
        </div>
      </section>

      {/* Grupos */}
      <section className="grid gap-2">
        <h3 className="font-semibold">Quais grupos recebem</h3>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!chooseGroups} onChange={() => set("groupIds", chooseGroups ? [] : targets.map((g) => g.id))} />
          Todos com &quot;Postar neste grupo&quot; ligado (em Canais)
        </label>
        {chooseGroups ? (
          <div className="grid max-h-60 gap-1 overflow-y-auto rounded-md border p-2">
            {sendable.map((g) => (
              <label key={g.id} className="flex items-center gap-2">
                <input type="checkbox" checked={s.groupIds.includes(g.id)} onChange={() => set("groupIds", toggle(s.groupIds, g.id))} />
                {g.name}
              </label>
            ))}
          </div>
        ) : null}
        <p className="text-muted-foreground">{targets.length} grupo(s) vão receber.</p>
      </section>

      {/* Avançado */}
      <section className="grid gap-3">
        <h3 className="font-semibold">Segurança do número</h3>
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label htmlFor="ap-gmin">Intervalo entre grupos: mín. (s)</Label>
            <Input id="ap-gmin" type="number" min={15} max={600} value={s.groupIntervalMinSeconds} onChange={(e) => set("groupIntervalMinSeconds", Number(e.target.value) || 30)} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-gmax">máx. (s)</Label>
            <Input id="ap-gmax" type="number" min={15} max={600} value={s.groupIntervalMaxSeconds} onChange={(e) => set("groupIntervalMaxSeconds", Number(e.target.value) || 90)} className="w-28" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-daily">Mensagens por número por dia</Label>
            <Input id="ap-daily" type="number" min={20} max={300} value={s.channelDailyLimit} onChange={(e) => set("channelDailyLimit", Number(e.target.value) || 80)} className="w-36" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ap-repeat">Não repetir no grupo por (dias)</Label>
            <Input id="ap-repeat" type="number" min={1} max={30} value={s.repeatDays} onChange={(e) => set("repeatDays", Number(e.target.value) || 3)} className="w-36" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Número novo começa com até 20 mensagens no primeiro dia e chega ao limite acima no 7º dia (aquecimento).
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || tooMany}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
        {feedback ? <p className={feedback.ok ? "text-green-700" : "text-destructive"}>{feedback.text}</p> : null}
      </div>
    </div>
  );
}
