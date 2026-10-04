"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormField({
  label,
  errors,
  hint,
  ...inputProps
}: { label: string; errors?: string[] | undefined; hint?: ReactNode } & ComponentProps<typeof Input> & {
    name: string;
  }) {
  const id = inputProps.id ?? inputProps.name;
  const errorId = `${id}-erro`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? errorId : undefined}
        {...inputProps}
      />
      {hint && !errors?.length ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors?.length ? (
        <p id={errorId} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingText }: { children: ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ error, success }: { error?: string | undefined; success?: string | undefined }) {
  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (success) {
    return (
      <Alert role="status">
        <AlertDescription>{success}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
