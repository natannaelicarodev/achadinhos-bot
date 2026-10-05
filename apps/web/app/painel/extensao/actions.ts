"use server";

import { requireSession } from "@/lib/auth/current";
import { CATEGORIES, ML_CATEGORY_IDS, ML_KEYWORD_SEARCHES } from "@/lib/catalog";
import { isSystemAdmin } from "@/lib/ml-vitrine";

/**
 * Vitrine compartilhada: entrega a chave (ML_VITRINE_TOKEN) SÓ para o administrador
 * do sistema, para a extensão dele enviar a vitrine do ML ao catálogo central.
 */
export async function vitrineSetupAction(): Promise<
  { ok: true; token: string; categories: string[]; searches: string[] } | { ok: false; error: string }
> {
  const { user } = await requireSession();
  if (!isSystemAdmin(user.email)) return { ok: false, error: "Só o administrador do sistema pode ativar a vitrine." };
  const token = process.env.ML_VITRINE_TOKEN?.trim();
  if (!token || token.length < 32) {
    return { ok: false, error: "Falta a ML_VITRINE_TOKEN no .env do servidor (mínimo 32 caracteres)." };
  }
  return {
    ok: true,
    token,
    categories: CATEGORIES.flatMap((c) => ML_CATEGORY_IDS[c.value] ?? []),
    searches: Object.keys(ML_KEYWORD_SEARCHES),
  };
}
