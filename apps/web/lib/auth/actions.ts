"use server";

import { getPrisma } from "@achadinhos/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { getEnv } from "../env";
import { sendPasswordResetEmail } from "../email";
import { authenticate, createPasswordResetToken, resetPasswordWithToken, signUp } from "./accounts";
import { deleteSessionCookie, getCurrentSession, setSessionCookie } from "./current";
import { rateLimit, resetRateLimit } from "./rate-limit";
import { loginSchema, requestResetSchema, resetPasswordSchema, signUpSchema } from "./schemas";
import { createSession, invalidateSession } from "./session";

export interface FormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const MINUTE = 60 * 1000;

function fieldErrors(error: z.ZodError): FormState {
  const flat: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (flat[key] ??= []).push(issue.message);
  }
  return { fieldErrors: flat };
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/** Só aceita caminhos internos do painel (evita open redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/painel") && !next.startsWith("//") ? next : "/painel";
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const { email, password } = parsed.data;
  const limitKey = `login:${await clientIp()}:${email}`;
  if (!rateLimit(limitKey, 5, 15 * MINUTE)) {
    return { error: "Muitas tentativas. Aguarde 15 minutos e tente de novo." };
  }

  const prisma = getPrisma();
  const user = await authenticate(prisma, email, password);
  if (!user) return { error: "E-mail ou senha inválidos." };

  resetRateLimit(limitKey);
  const { token, expiresAt } = await createSession(prisma, user.id);
  await setSessionCookie(token, expiresAt);
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  if (!rateLimit(`signup:${await clientIp()}`, 5, 60 * MINUTE)) {
    return { error: "Muitos cadastros a partir desta rede. Tente mais tarde." };
  }

  const prisma = getPrisma();
  const result = await signUp(prisma, parsed.data);
  if (!result.ok) return { fieldErrors: { email: ["Este e-mail já está cadastrado."] } };

  const { token, expiresAt } = await createSession(prisma, result.userId);
  await setSessionCookie(token, expiresAt);
  redirect("/painel");
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = requestResetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  // Mesma resposta exista ou não o e-mail (não revela quem tem conta).
  const success = "Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha.";
  if (!rateLimit(`reset:${await clientIp()}:${parsed.data.email}`, 3, 15 * MINUTE)) return { success };

  const result = await createPasswordResetToken(getPrisma(), parsed.data.email);
  if (result) {
    const url = new URL("/redefinir-senha", getEnv().APP_URL);
    url.searchParams.set("token", result.token);
    try {
      await sendPasswordResetEmail(result.user, url.toString());
    } catch (error) {
      console.error("[email] falha ao enviar recuperação de senha", error);
      return { error: "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos." };
    }
  }
  return { success };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const result = await resetPasswordWithToken(getPrisma(), parsed.data.token, parsed.data.password);
  if (result === "invalid") {
    return { error: "Link inválido ou expirado. Peça um novo em “Esqueci minha senha”." };
  }
  redirect("/login?senha=redefinida");
}

export async function logoutAction(): Promise<void> {
  const current = await getCurrentSession();
  if (current) await invalidateSession(getPrisma(), current.session.id);
  await deleteSessionCookie();
  redirect("/login");
}
