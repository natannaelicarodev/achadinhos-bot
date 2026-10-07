"use server";

import { getPrisma, recomputeHeadlineKeys } from "@achadinhos/db";
import { classifyForCatalog } from "@achadinhos/stores";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current";
import { confirmPassword } from "@/lib/auth/reauth";
import { isSystemAdmin } from "@/lib/ml-vitrine";

/** Recalcula o tipo (headline) de todo o catálogo com o dicionário atual. Só o administrador. */
export async function recomputeHeadlinesAction(password: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { user } = await requireSession();
  if (!isSystemAdmin(user)) return { ok: false, error: "Só o administrador do sistema." };
  const reauth = await confirmPassword(user.id, password);
  if (!reauth.ok) return reauth;
  const { checked, updated } = await recomputeHeadlineKeys(getPrisma(), (p) => classifyForCatalog(p));
  revalidatePath("/painel/relatorios");
  return { ok: true, message: `${checked} produtos conferidos, ${updated} com tipo ou categoria atualizados.` };
}
