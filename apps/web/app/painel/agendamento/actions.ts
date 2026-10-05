"use server";

import {
  autopilotStores,
  forTenant,
  maxOffersPerHour,
  MAX_OFFERS_PER_HOUR,
  type CatalogCategory,
  type Store,
} from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const CATEGORIES = [
  "FOOD_BEVERAGES",
  "BEAUTY",
  "HOME_KITCHEN_DECOR",
  "ELECTRONICS",
  "KIDS_BABY",
  "FASHION",
  "PETS",
  "HEALTH",
] as const satisfies readonly CatalogCategory[];

const optionalInt = (max: number) => z.number().int().min(0).max(max).nullable();
const optionalNumber = (max: number) => z.number().min(0).max(max).nullable();

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Escolha pelo menos um dia da semana.").max(7),
    windowStartMinute: z.number().int().min(0).max(24 * 60 - 1),
    windowEndMinute: z.number().int().min(1).max(24 * 60),
    offersPerHour: z.number().int().min(1).max(MAX_OFFERS_PER_HOUR),
    stores: z.array(z.enum(["SHOPEE", "AMAZON", "MERCADO_LIVRE"])).max(3),
    categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
    minDiscountPct: optionalInt(95),
    minPriceCents: optionalInt(100_000_000),
    maxPriceCents: optionalInt(100_000_000),
    minRating: optionalNumber(5),
    minCommissionPct: optionalNumber(100),
    groupIds: z.array(z.string().min(1).max(100)).max(500),
    repeatDays: z.number().int().min(1).max(30),
    groupIntervalMinSeconds: z.number().int().min(15).max(600),
    groupIntervalMaxSeconds: z.number().int().min(15).max(600),
    channelDailyLimit: z.number().int().min(20).max(300),
  })
  .refine((s) => s.windowEndMinute > s.windowStartMinute, "O horário final precisa ser depois do inicial.")
  .refine((s) => s.groupIntervalMaxSeconds >= s.groupIntervalMinSeconds, "O intervalo máximo precisa ser maior ou igual ao mínimo.")
  .refine(
    (s) => s.minPriceCents === null || s.maxPriceCents === null || s.maxPriceCents >= s.minPriceCents,
    "O preço máximo precisa ser maior que o mínimo.",
  );

export type AutopilotSettingsInput = z.input<typeof settingsSchema>;

export async function saveAutopilotSettingsAction(input: AutopilotSettingsInput): Promise<ActionResult> {
  const { user } = await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const data = parsed.data;
  const db = forTenant(user.tenantId);

  // Só lojas que o piloto pode usar (ML só com ML_AUTOPILOT_ENABLED).
  const allowed = autopilotStores();
  const stores = data.stores.filter((s) => allowed.includes(s as Store));

  // Grupos: só do próprio tenant, ativos e onde o número pode enviar.
  const groups = await db.group.findMany({
    where: { active: true, canSend: true, channel: { type: "WHATSAPP" } },
    select: { id: true, channelId: true, postingEnabled: true },
  });
  const groupIds = data.groupIds.filter((id) => groups.some((g) => g.id === id));
  const targets = groupIds.length > 0 ? groups.filter((g) => groupIds.includes(g.id)) : groups.filter((g) => g.postingEnabled);
  const perChannel = new Map<string, number>();
  for (const g of targets) perChannel.set(g.channelId, (perChannel.get(g.channelId) ?? 0) + 1);
  const maxGroups = Math.max(0, ...perChannel.values());
  const max = maxOffersPerHour(maxGroups, data.groupIntervalMaxSeconds);
  if (data.offersPerHour > max) {
    return { ok: false, error: `Com ${maxGroups} grupos no mesmo número, o máximo é ${max} ofertas por hora.` };
  }

  const values = { ...data, stores, groupIds };
  await db.autopilotSettings.upsert({
    where: { tenantId: user.tenantId },
    create: { tenantId: user.tenantId, ...values },
    update: values,
  });
  revalidatePath("/painel/agendamento");
  return { ok: true, message: data.enabled ? "Piloto automático salvo e ligado." : "Configuração salva (piloto desligado)." };
}

const idSchema = z.string().min(1).max(100);

export async function pauseChannelAction(channelId: string): Promise<ActionResult> {
  const { user } = await requireSession();
  const id = idSchema.safeParse(channelId);
  if (!id.success) return { ok: false, error: "Número inválido." };
  const { count } = await forTenant(user.tenantId).channel.updateMany({
    where: { id: id.data },
    data: { autopilotPausedAt: new Date(), autopilotPauseReason: "Pausado por você.", consecutiveFailures: 0 },
  });
  revalidatePath("/painel", "layout");
  return count ? { ok: true, message: "Envios deste número pausados." } : { ok: false, error: "Número não encontrado." };
}

export async function resumeChannelAction(channelId: string): Promise<ActionResult> {
  const { user } = await requireSession();
  const id = idSchema.safeParse(channelId);
  if (!id.success) return { ok: false, error: "Número inválido." };
  const { count } = await forTenant(user.tenantId).channel.updateMany({
    where: { id: id.data },
    data: { autopilotPausedAt: null, autopilotPauseReason: null, consecutiveFailures: 0, nextSendAt: null },
  });
  revalidatePath("/painel", "layout");
  return count ? { ok: true, message: "Envios deste número retomados." } : { ok: false, error: "Número não encontrado." };
}

export async function resumeStoreAction(store: string): Promise<ActionResult> {
  const { user } = await requireSession();
  const parsed = z.enum(["SHOPEE", "AMAZON", "MERCADO_LIVRE", "SHEIN"]).safeParse(store);
  if (!parsed.success) return { ok: false, error: "Loja inválida." };
  await forTenant(user.tenantId).storeCredential.updateMany({
    where: { store: parsed.data },
    data: { autopilotPausedAt: null },
  });
  revalidatePath("/painel", "layout");
  return { ok: true, message: "Loja de volta ao piloto automático." };
}

/** Modo acelerado (só desenvolvimento): o piloto escolhe uma oferta no próximo tick. */
export async function devPickNowAction(): Promise<ActionResult> {
  if (process.env.NODE_ENV === "production" || process.env.AUTOPILOT_DEV_FAST !== "true") {
    return { ok: false, error: "Disponível só no modo acelerado de desenvolvimento." };
  }
  const { user } = await requireSession();
  const { count } = await forTenant(user.tenantId).autopilotSettings.updateMany({ data: { lastPickAt: null } });
  return count
    ? { ok: true, message: "Pronto: o worker escolhe uma oferta em até 5 segundos (se estiver na janela)." }
    : { ok: false, error: "Salve a configuração do piloto primeiro." };
}
