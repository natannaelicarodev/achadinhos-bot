"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormField, FormMessage, SubmitButton } from "@/components/form";
import { requestPasswordResetAction, type FormState } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {} as FormState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage error={state.error} success={state.success} />
      <FormField
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        errors={state.fieldErrors?.email}
      />
      <SubmitButton pendingText="Enviando...">Enviar link</SubmitButton>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Voltar para o login
      </Link>
    </form>
  );
}
