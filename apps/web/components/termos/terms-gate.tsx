import Link from "next/link";
import { acceptTermsAction } from "@/lib/terms-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Termos novos (ou conta antiga): aceitar antes de usar o painel. */
export function TermsGate() {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Termos de uso atualizados</CardTitle>
          <CardDescription>
            Para continuar, leia e aceite os Termos de uso. Destaques: o envio pelo WhatsApp tem risco de banimento do número;
            a cobrança é recorrente pelo Asaas; atraso pausa os envios sem apagar nada; você tem 7 dias para se arrepender com
            reembolso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={acceptTermsAction} className="grid gap-4 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="acceptTerms" required className="mt-1" />
              <span>
                Li e aceito os{" "}
                <Link href="/termos" target="_blank" className="underline underline-offset-4">
                  Termos de uso
                </Link>
                , inclusive o risco de banimento do número no WhatsApp.
              </span>
            </label>
            <Button type="submit" className="w-fit">
              Aceitar e continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
