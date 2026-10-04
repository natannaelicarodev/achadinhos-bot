"use server";

import { createOfferFromCatalog, toggleFavorite } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";

const productId = z.string().min(1).max(100);

export async function toggleFavoriteAction(id: string): Promise<{ favorite: boolean } | { error: string }> {
  const { user } = await requireSession();
  const parsed = productId.safeParse(id);
  if (!parsed.success) return { error: "Produto não encontrado." };
  const favorite = await toggleFavorite(user.tenantId, parsed.data);
  if (favorite === null) return { error: "Produto não encontrado." };
  revalidatePath("/painel/catalogo");
  return { favorite };
}

/** "Divulgar este produto": cria a oferta em rascunho do tenant (uma por produto). */
export async function promoteProductAction(id: string): Promise<{ message: string } | { error: string }> {
  const { user } = await requireSession();
  const parsed = productId.safeParse(id);
  if (!parsed.success) return { error: "Produto não encontrado." };
  const result = await createOfferFromCatalog(user.tenantId, parsed.data);
  if (!result) return { error: "Este produto saiu do catálogo." };
  revalidatePath("/painel/catalogo");
  return {
    message: result.created
      ? "Adicionado às suas ofertas (rascunho). O link de afiliado com a sua etiqueta chega na próxima atualização."
      : "Este produto já está nas suas ofertas.",
  };
}
