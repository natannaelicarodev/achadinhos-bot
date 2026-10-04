"use server";

import { deleteStoreCredential, saveStoreCredential, setStoreCredentialStatus } from "@achadinhos/db";
import {
  AFFILIATE_STORES,
  amazonSecretsSchema,
  mercadoLivreSecretsSchema,
  readMercadoLivreAffiliateLink,
  readSheinAffiliateId,
  sheinSecretsSchema,
  ShopeeLinkGenerator,
  shopeeErrorMessage,
  shopeeSecretsSchema,
  StoreUrlError,
  type AffiliateStore,
} from "@achadinhos/stores";
import { getStoreCredentialSecrets } from "@achadinhos/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";

export type CredentialResult = { ok: true; message: string } | { ok: false; error: string };

const ONLY_OWNER = "Só o dono da conta pode alterar as credenciais.";
const PATH = "/painel/credenciais";

async function ownerTenantId(): Promise<string | null> {
  const { user } = await requireSession();
  return user.role === "OWNER" ? user.tenantId : null;
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Dados inválidos.";

/** Testa a credencial da Shopee com uma chamada real (gera um link) e marca o status. */
async function testShopee(tenantId: string): Promise<CredentialResult> {
  const secrets = shopeeSecretsSchema.safeParse(await getStoreCredentialSecrets(tenantId, "SHOPEE"));
  if (!secrets.success) return { ok: false, error: "Salve o AppID e a Senha da API antes de testar." };
  try {
    await new ShopeeLinkGenerator({ appId: secrets.data.appId, secret: secrets.data.apiSecret }).test();
    await setStoreCredentialStatus(tenantId, "SHOPEE", { ok: true });
    return { ok: true, message: "Sincronizado: a Shopee aceitou sua credencial." };
  } catch (error) {
    const message = shopeeErrorMessage(error);
    await setStoreCredentialStatus(tenantId, "SHOPEE", { ok: false, error: message });
    return { ok: false, error: message };
  }
}

export async function saveShopeeAction(input: { appId: string; apiSecret: string }): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  const parsed = shopeeSecretsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  await saveStoreCredential(tenantId, { store: "SHOPEE", secrets: parsed.data });
  const result = await testShopee(tenantId);
  revalidatePath(PATH);
  return result.ok ? result : { ok: false, error: `Salvo, mas o teste falhou: ${result.error}` };
}

export async function testShopeeAction(): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  const result = await testShopee(tenantId);
  revalidatePath(PATH);
  return result;
}

export async function saveAmazonAction(input: {
  tag: string;
  creatorsCredentialId?: string;
  creatorsCredentialSecret?: string;
}): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  const parsed = amazonSecretsSchema.safeParse({
    tag: input.tag,
    ...(input.creatorsCredentialId?.trim() ? { creatorsCredentialId: input.creatorsCredentialId } : {}),
    ...(input.creatorsCredentialSecret?.trim() ? { creatorsCredentialSecret: input.creatorsCredentialSecret } : {}),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const secrets = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v)) as Record<string, string>;
  await saveStoreCredential(tenantId, { store: "AMAZON", secrets, verifiedAt: new Date() });
  revalidatePath(PATH);
  return { ok: true, message: "Tag da Amazon salva." };
}

/** Lê Etiqueta e ID da Ferramenta de um link de afiliado do Mercado Livre (não salva). */
export async function readMercadoLivreLinkAction(link: string) {
  if (!(await ownerTenantId())) return { ok: false as const, error: ONLY_OWNER };
  try {
    return { ok: true as const, ...(await readMercadoLivreAffiliateLink(link)) };
  } catch (error) {
    if (error instanceof StoreUrlError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "Não foi possível ler o link agora. Tente de novo." };
  }
}

export async function saveMercadoLivreAction(input: { mattWord: string; mattTool: string }): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  const parsed = mercadoLivreSecretsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  await saveStoreCredential(tenantId, { store: "MERCADO_LIVRE", secrets: parsed.data, verifiedAt: new Date() });
  revalidatePath(PATH);
  return { ok: true, message: "Etiqueta do Mercado Livre salva." };
}

/** ID de afiliado da Shein: link (segue o redirecionamento) ou número digitado (não salva). */
export async function readSheinAction(value: string) {
  if (!(await ownerTenantId())) return { ok: false as const, error: ONLY_OWNER };
  try {
    return { ok: true as const, ...(await readSheinAffiliateId(value)) };
  } catch (error) {
    if (error instanceof StoreUrlError) return { ok: false as const, error: error.message };
    if (error instanceof z.ZodError) return { ok: false as const, error: firstIssue(error) };
    return { ok: false as const, error: "Não foi possível ler o link agora. Tente de novo." };
  }
}

export async function saveSheinAction(input: { affiliateId: string }): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  const parsed = sheinSecretsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  await saveStoreCredential(tenantId, { store: "SHEIN", secrets: parsed.data, verifiedAt: new Date() });
  revalidatePath(PATH);
  return { ok: true, message: "ID de afiliado da Shein salvo." };
}

export async function removeCredentialAction(store: AffiliateStore): Promise<CredentialResult> {
  const tenantId = await ownerTenantId();
  if (!tenantId) return { ok: false, error: ONLY_OWNER };
  if (!(AFFILIATE_STORES as readonly string[]).includes(store)) return { ok: false, error: "Loja inválida." };
  await deleteStoreCredential(tenantId, store);
  revalidatePath(PATH);
  return { ok: true, message: "Credencial removida." };
}
