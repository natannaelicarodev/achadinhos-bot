"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormField, FormMessage, SubmitButton } from "@/components/form";
import { signUpAction, type FormState } from "@/lib/auth/actions";

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, {} as FormState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage error={state.error} />
      <FormField
        label="Nome do negócio"
        name="tenantName"
        placeholder="Ex.: Achadinhos da Ana"
        required
        errors={state.fieldErrors?.tenantName}
      />
      <FormField label="Seu nome" name="name" autoComplete="name" required errors={state.fieldErrors?.name} />
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
        autoComplete="new-password"
        minLength={8}
        required
        hint="Mínimo de 8 caracteres."
        errors={state.fieldErrors?.password}
      />
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" required className="mt-1" />
          <span>
            Li e aceito os{" "}
            <Link href="/termos" target="_blank" className="underline underline-offset-4">
              Termos de uso
            </Link>
            , inclusive o risco de banimento do número no WhatsApp.
          </span>
        </label>
        {state.fieldErrors?.acceptTerms ? <p className="text-xs text-destructive">{state.fieldErrors.acceptTerms[0]}</p> : null}
      </div>
      <SubmitButton pendingText="Criando conta...">Criar conta e começar o teste</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
