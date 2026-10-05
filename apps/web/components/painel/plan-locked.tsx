import { FIRST_SENDING_PLAN_NAME } from "@achadinhos/db";
import { LockIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Recurso fora do plano atual (ex.: plano "Catálogo" sem números, grupos e envios). */
export function PlanLocked({ feature }: { feature: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="size-4" /> Disponível a partir do plano {FIRST_SENDING_PLAN_NAME}
        </CardTitle>
        <CardDescription>
          {feature} faz parte dos planos com WhatsApp. No seu plano atual você usa o catálogo, as credenciais, a conversão de
          links e o &quot;Divulgar link&quot; com a mensagem pronta para copiar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button render={<Link href="/painel/configuracoes#plano" />} nativeButton={false}>
          Mudar de plano
        </Button>
      </CardContent>
    </Card>
  );
}
