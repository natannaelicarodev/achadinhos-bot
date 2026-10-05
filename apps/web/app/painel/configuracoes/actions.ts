"use server";

import { forTenant } from "@achadinhos/db";
import { validateTemplate } from "@achadinhos/stores/message";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";

export type TemplateResult = { ok: true; message: string } | { ok: false; error: string };

const templateSchema = z.object({
  body: z.string().max(2000),
  headline: z.string().trim().min(1, "Informe a chamada padrão ({headline}).").max(120),
  autoHeadlines: z.boolean(),
  customHeadlines: z
    .array(z.string().trim().max(120, "Cada headline própria pode ter até 120 caracteres."))
    .max(50, "No máximo 50 headlines próprias.")
    .transform((list) => [...new Set(list.filter(Boolean))]),
});

/** Salva o modelo de mensagem do tenant (só o dono). */
export async function saveTemplateAction(input: z.input<typeof templateSchema>): Promise<TemplateResult> {
  const { user } = await requireSession();
  if (user.role !== "OWNER") return { ok: false, error: "Só o dono da conta pode alterar o modelo de mensagem." };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const errors = validateTemplate(parsed.data.body);
  if (errors.length) return { ok: false, error: errors[0]! };

  const data = {
    body: parsed.data.body.replace(/\r\n/g, "\n"),
    headline: parsed.data.headline,
    autoHeadlines: parsed.data.autoHeadlines,
    customHeadlines: parsed.data.customHeadlines,
  };
  await forTenant(user.tenantId).messageTemplate.upsert({
    where: { tenantId: user.tenantId },
    create: { tenantId: user.tenantId, ...data },
    update: data,
  });
  revalidatePath("/painel/configuracoes");
  return { ok: true, message: "Modelo salvo. As próximas mensagens já saem com ele." };
}

/** Volta para o modelo padrão (apaga o personalizado). */
export async function resetTemplateAction(): Promise<TemplateResult> {
  const { user } = await requireSession();
  if (user.role !== "OWNER") return { ok: false, error: "Só o dono da conta pode alterar o modelo de mensagem." };
  await forTenant(user.tenantId).messageTemplate.deleteMany({ where: { tenantId: user.tenantId } });
  revalidatePath("/painel/configuracoes");
  return { ok: true, message: "Modelo padrão restaurado." };
}
