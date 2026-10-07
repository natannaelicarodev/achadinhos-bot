"use server";

import { forTenant } from "@achadinhos/db";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/current";
import { TERMS_VERSION } from "@/lib/terms";

/** Aceite dos termos (versão atual) pelo usuário logado. */
export async function acceptTermsAction(formData: FormData) {
  const { user } = await requireSession();
  if (formData.get("acceptTerms") !== "on") redirect("/painel");
  await forTenant(user.tenantId).user.update({
    where: { id: user.id },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() },
  });
  redirect("/painel");
}
