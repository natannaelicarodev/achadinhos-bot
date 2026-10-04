import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar — Achadinhos Bot" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; senha?: string }>;
}) {
  const { next, senha } = await searchParams;
  const notice = senha === "redefinida" ? "Senha redefinida. Entre com a nova senha." : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} notice={notice} />
      </CardContent>
    </Card>
  );
}
