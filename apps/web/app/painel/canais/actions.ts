"use server";

import {
  assertCanAddWhatsappNumber,
  assertCanEnableGroupPosting,
  forTenant,
  PlanLimitError,
} from "@achadinhos/db";
import { whatsappJobSchemas } from "@achadinhos/jobs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { enqueueWhatsappJob, runWhatsappJob } from "@/lib/queue";

export interface ActionResult {
  error?: string;
  success?: string;
  warning?: string;
}

const ONLY_OWNER = "Só o dono da conta pode conectar ou remover números.";
const WORKER_OFFLINE = "Não foi possível falar com o worker (Redis). Confira o REDIS_URL e se o worker está rodando.";

async function ownerContext() {
  const { user } = await requireSession();
  if (user.role !== "OWNER") return null;
  return { user, db: forTenant(user.tenantId) };
}

async function findWhatsappChannel(tenantId: string, channelId: unknown) {
  const id = z.string().min(1).safeParse(channelId);
  if (!id.success) return null;
  const channel = await forTenant(tenantId).channel.findUnique({ where: { id: id.data } });
  return channel?.type === "WHATSAPP" ? channel : null;
}

export async function connectWhatsappAction(): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { error: ONLY_OWNER };
  try {
    await assertCanAddWhatsappNumber(ctx.user.tenantId);
    const count = await ctx.db.channel.count({ where: { type: "WHATSAPP" } });
    const channel = await ctx.db.channel.create({
      data: { tenantId: ctx.user.tenantId, type: "WHATSAPP", name: `WhatsApp ${count + 1}`, status: "CONNECTING" },
    });
    try {
      await enqueueWhatsappJob("connect", { tenantId: ctx.user.tenantId, channelId: channel.id });
    } catch {
      await ctx.db.channel.update({
        where: { id: channel.id },
        data: { status: "ERROR", statusReason: "Worker indisponível. Clique em Reconectar." },
      });
      return { error: WORKER_OFFLINE };
    }
  } catch (error) {
    if (error instanceof PlanLimitError) return { error: error.message };
    throw error;
  }
  revalidatePath("/painel/canais");
  return { success: "Gerando o QR Code..." };
}

export async function reconnectWhatsappAction(channelId: string): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { error: ONLY_OWNER };
  const channel = await findWhatsappChannel(ctx.user.tenantId, channelId);
  if (!channel) return { error: "Número não encontrado." };
  await ctx.db.channel.update({ where: { id: channel.id }, data: { status: "CONNECTING", statusReason: null } });
  try {
    await enqueueWhatsappJob("connect", { tenantId: ctx.user.tenantId, channelId: channel.id });
  } catch {
    return { error: WORKER_OFFLINE };
  }
  revalidatePath("/painel/canais");
  return { success: "Reconectando..." };
}

export async function removeWhatsappAction(channelId: string): Promise<ActionResult> {
  const ctx = await ownerContext();
  if (!ctx) return { error: ONLY_OWNER };
  const channel = await findWhatsappChannel(ctx.user.tenantId, channelId);
  if (!channel) return { error: "Número não encontrado." };
  const result = await runWhatsappJob("remove", { tenantId: ctx.user.tenantId, channelId: channel.id }, 30_000).catch(
    () => ({ ok: false as const, message: WORKER_OFFLINE }),
  );
  revalidatePath("/painel/canais");
  return result.ok ? { success: result.message } : { error: result.message };
}

export async function syncGroupsAction(channelId: string): Promise<ActionResult> {
  const { user } = await requireSession();
  const channel = await findWhatsappChannel(user.tenantId, channelId);
  if (!channel) return { error: "Número não encontrado." };
  const result = await runWhatsappJob("syncGroups", { tenantId: user.tenantId, channelId: channel.id }, 30_000).catch(
    () => ({ ok: false as const, message: WORKER_OFFLINE }),
  );
  revalidatePath(`/painel/canais/whatsapp/${channel.id}`);
  return result.ok ? { success: result.message } : { error: result.message };
}

export async function setGroupPostingAction(groupId: string, enabled: boolean): Promise<ActionResult> {
  const { user } = await requireSession();
  const db = forTenant(user.tenantId);
  const group = await db.group.findUnique({ where: { id: z.string().parse(groupId) } });
  if (!group) return { error: "Grupo não encontrado." };
  if (enabled) {
    if (!group.active) return { error: "O número não participa mais deste grupo." };
    if (!group.canSend) return { error: "Neste grupo só administradores podem enviar mensagens." };
    if (!group.postingEnabled) {
      try {
        await assertCanEnableGroupPosting(user.tenantId);
      } catch (error) {
        if (error instanceof PlanLimitError) return { error: error.message };
        throw error;
      }
    }
  }
  await db.group.update({ where: { id: group.id }, data: { postingEnabled: enabled } });
  revalidatePath(`/painel/canais/whatsapp/${group.channelId}`);
  return {};
}

const sendTestForm = z.object({
  groupId: z.string().min(1),
  text: whatsappJobSchemas.sendTest.shape.text,
  imageUrl: z.preprocess((v) => (v === "" ? undefined : v), whatsappJobSchemas.sendTest.shape.imageUrl),
});

export async function sendTestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user } = await requireSession();
  const parsed = sendTestForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Escreva o texto da mensagem (até 4096 caracteres)." };

  const group = await forTenant(user.tenantId).group.findUnique({ where: { id: parsed.data.groupId } });
  if (!group) return { error: "Grupo não encontrado." };

  const result = await runWhatsappJob(
    "sendTest",
    {
      tenantId: user.tenantId,
      channelId: group.channelId,
      groupId: group.id,
      text: parsed.data.text,
      ...(parsed.data.imageUrl ? { imageUrl: parsed.data.imageUrl } : {}),
    },
    45_000,
  ).catch(() => ({ ok: false as const, message: WORKER_OFFLINE }));

  if (!result.ok) return { error: result.message };
  return { success: result.message, ...(result.warning ? { warning: result.warning } : {}) };
}
