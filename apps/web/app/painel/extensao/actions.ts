"use server";

import { forTenant } from "@achadinhos/db";
import { requireSession } from "@/lib/auth/current";
import { hashExtensionToken, newExtensionToken } from "@/lib/extension-autopilot";
import { AMAZON_BESTSELLER_CATEGORIES, CATEGORIES, ML_CATEGORY_IDS, ML_KEYWORD_SEARCHES } from "@/lib/catalog";
import { isSystemAdmin } from "@/lib/ml-vitrine";

/**
 * Vitrine compartilhada: entrega a chave (ML_VITRINE_TOKEN) SÓ para o administrador
 * do sistema, para a extensão dele enviar a vitrine do ML ao catálogo central.
 */
export async function vitrineSetupAction(): Promise<
  { ok: true; token: string; categories: string[]; searches: string[]; amazonCategories: string[] } | { ok: false; error: string }
> {
  const { user } = await requireSession();
  if (!isSystemAdmin(user)) return { ok: false, error: "Só o administrador do sistema pode ativar a vitrine." };
  const token = process.env.ML_VITRINE_TOKEN?.trim();
  if (!token || token.length < 32) {
    return { ok: false, error: "Falta a ML_VITRINE_TOKEN no .env do servidor (mínimo 32 caracteres)." };
  }
  return {
    ok: true,
    token,
    categories: CATEGORIES.flatMap((c) => ML_CATEGORY_IDS[c.value] ?? []),
    searches: Object.keys(ML_KEYWORD_SEARCHES),
    amazonCategories: Object.keys(AMAZON_BESTSELLER_CATEGORIES),
  };
}

/**
 * Piloto automático + Mercado Livre: chave pessoal da extensão deste usuário (a anterior
 * deixa de valer). O banco guarda só o hash; a chave vai uma vez para a extensão.
 */
export async function pairExtensionAutopilotAction(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { user } = await requireSession();
  const token = newExtensionToken();
  await forTenant(user.tenantId).extensionToken.upsert({
    where: { tenantId_userId: { tenantId: user.tenantId, userId: user.id } },
    create: { tenantId: user.tenantId, userId: user.id, tokenHash: hashExtensionToken(token), lastSeenAt: new Date() },
    update: { tokenHash: hashExtensionToken(token), lastSeenAt: new Date() },
  });
  return { ok: true, token };
}

/** Desliga: apaga a chave (a extensão para de gerar meli.la para o piloto). */
export async function unpairExtensionAutopilotAction(): Promise<{ ok: true }> {
  const { user } = await requireSession();
  await forTenant(user.tenantId).extensionToken.deleteMany({ where: { userId: user.id } });
  return { ok: true };
}
