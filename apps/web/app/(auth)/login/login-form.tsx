"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormField, FormMessage, SubmitButton } from "@/components/form";
import { loginAction, type FormState } from "@/lib/auth/actions";

export function LoginForm({ next, notice }: { next?: string | undefined; notice?: string | undefined }) {
  const [state, action] = useActionState(loginAction, {} as FormState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage error={state.error} success={state.error ? undefined : notice} />
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        errors={state.fieldErrors?.email}
      />
      <FormField
        label="Senha"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <SubmitButton pendingText="Entrando...">Entrar</SubmitButton>
      <div className="flex justify-between text-sm">
        <Link href="/esqueci-senha" className="text-muted-foreground underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
        <Link href="/cadastro" className="underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </div>
    </form>
  );
}
