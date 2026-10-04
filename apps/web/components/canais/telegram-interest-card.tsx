"use client";

import { CheckCircle2Icon, SendIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { requestFeatureAction } from "@/app/painel/canais/feature-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

export function TelegramInterestCard({ requestedAt }: { requestedAt: string | null }) {
  const [requested, setRequested] = useState(requestedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SendIcon className="size-4" /> Telegram
        </CardTitle>
        <CardDescription>
          Postar ofertas em canais e grupos do Telegram vem numa atualização futura. Por enquanto, o Achadinhos Bot
          posta no WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {requested ? (
          <p className="flex items-center gap-2 text-sm" role="status">
            <CheckCircle2Icon className="size-4 text-green-600" />
            Obrigado! Avisaremos quando chegar.
            <span className="text-muted-foreground">(interesse registrado em {dateFormat.format(new Date(requested))})</span>
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Quer usar? Clique abaixo: isso nos ajuda a priorizar.</p>
            <Button
              className="w-fit"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await requestFeatureAction("telegram");
                  if (result.ok) {
                    setRequested(result.requestedAt);
                    setError(null);
                  } else {
                    setError(result.error);
                  }
                })
              }
            >
              {pending ? "Registrando..." : "Quero usar o Telegram"}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
