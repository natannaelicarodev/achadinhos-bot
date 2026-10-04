"use server";

import { toggleFavorite } from "@achadinhos/db";
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
