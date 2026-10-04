"use client";

import type { Store } from "@achadinhos/db";
import { useActionState, useState } from "react";
import { FormField, FormMessage, SubmitButton } from "@/components/form";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { FormState } from "@/lib/auth/actions";
import { STORE_CODES, STORES } from "@/lib/stores";
import { saveStoreCredentialAction } from "./actions";

export function StoreCredentialForm() {
  const [state, action] = useActionState(saveStoreCredentialAction, {} as FormState);
  const [store, setStore] = useState<Store>("AMAZON");

  return (
    <form action={action} className="grid gap-4" key={state.success}>
      <FormMessage error={state.error} success={state.success} />
      <div className="grid gap-2">
        <Label htmlFor="store">Loja</Label>
        <NativeSelect
          id="store"
          name="store"
          value={store}
          onChange={(event) => setStore(event.target.value as Store)}
          className="w-full"
        >
          {STORE_CODES.map((code) => (
            <option key={code} value={code}>
              {STORES[code].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormField label="Apelido (opcional)" name="label" placeholder="Ex.: Conta principal" maxLength={60} />
      {STORES[store].fields.map((field) => (
        <FormField
          key={`${store}-${field.name}`}
          label={field.label}
          name={field.name}
          type="password"
          autoComplete="off"
          required
          errors={state.fieldErrors?.[field.name]}
        />
      ))}
      <SubmitButton pendingText="Salvando...">Salvar credenciais</SubmitButton>
    </form>
  );
}
