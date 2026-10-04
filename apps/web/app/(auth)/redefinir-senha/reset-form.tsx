"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormField, FormMessage, SubmitButton } from "@/components/form";
import { resetPasswordAction, type FormState } from "@/lib/auth/actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, {} as FormState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage error={state.error ?? state.fieldErrors?.token?.[0]} />
      <input type="hidden" name="token" value={token} />
      <FormField
        label="Nova senha"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="Mínimo de 8 caracteres."
        errors={state.fieldErrors?.password}
      />
      <FormField
        label="Confirme a nova senha"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pendingText="Salvando...">Salvar nova senha</SubmitButton>
      <Link href="/esqueci-senha" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Pedir um novo link
      </Link>
    </form>
  );
}
