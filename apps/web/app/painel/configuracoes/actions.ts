"use server";

import { deleteStoreCredential, saveStoreCredential, type Store } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/auth/actions";
import { requireSession } from "@/lib/auth/current";
import { STORE_CODES, STORES } from "@/lib/stores";

const storeSchema = z.enum(STORE_CODES as [Store, ...Store[]], { message: "Escolha uma loja." });

async function requireOwner() {
  const { user } = await requireSession();
  return user.role === "OWNER" ? user : null;
}

export async function saveStoreCredentialAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireOwner();
  if (!user) return { error: "Só o dono da conta pode alterar credenciais de lojas." };

  const store = storeSchema.safeParse(formData.get("store"));
  if (!store.success) return { fieldErrors: { store: ["Escolha uma loja."] } };

  const label = z.string().trim().max(60).safeParse(formData.get("label") ?? "");
  const secrets: Record<string, string> = {};
  const errors: Record<string, string[]> = {};
  for (const field of STORES[store.data].fields) {
    const value = z.string().trim().min(1).max(500).safeParse(formData.get(field.name));
    if (value.success) secrets[field.name] = value.data;
    else errors[field.name] = [`Informe ${field.label.toLowerCase()}.`];
  }
  if (Object.keys(errors).length > 0) return { fieldErrors: errors };

  await saveStoreCredential(user.tenantId, {
    store: store.data,
    label: label.success && label.data ? label.data : null,
    secrets,
  });
  revalidatePath("/painel/configuracoes");
  return { success: `Credenciais da ${STORES[store.data].label} salvas (criptografadas).` };
}

export async function deleteStoreCredentialAction(formData: FormData): Promise<void> {
  const user = await requireOwner();
  const store = storeSchema.safeParse(formData.get("store"));
  if (!user || !store.success) return;
  await deleteStoreCredential(user.tenantId, store.data);
  revalidatePath("/painel/configuracoes");
}
