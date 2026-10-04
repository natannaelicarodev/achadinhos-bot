import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

// no-referrer: o token da URL não vaza para outros sites.
export const metadata: Metadata = { title: "Redefinir senha — Achadinhos Bot", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Redefinir senha</CardTitle>
        <CardDescription>Escolha uma nova senha para sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-sm">
            Link incompleto.{" "}
            <Link href="/esqueci-senha" className="underline underline-offset-4">
              Peça um novo link
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
