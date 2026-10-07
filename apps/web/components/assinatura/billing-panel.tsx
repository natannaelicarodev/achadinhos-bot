"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  cancelPlanChangeAction,
  cancelSubscriptionAction,
  changePlanAction,
  refreshBillingAction,
  subscribeAction,
  type BillingResult,
} from "@/app/painel/assinatura/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface PlanOption {
  code: string;
  name: string;
  priceCents: number;
  annualPriceCents: number;
  features: string[];
}

type Cycle = "MONTHLY" | "YEARLY";
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function BillingPanel(props: {
  plans: PlanOption[];
  currentPlanCode: string | null;
  currentCycle: Cycle;
  /** Já tem assinatura no Asaas (não cancelada)? */
  subscribed: boolean;
  hasPendingChange: boolean;
  /** Já tem cliente no Asaas (não pede CPF/CNPJ de novo). */
  hasCustomer: boolean;
  canEdit: boolean;
  configured: boolean;
}) {
  const [cycle, setCycle] = useState<Cycle>(props.currentCycle);
  const [planCode, setPlanCode] = useState(props.currentPlanCode ?? props.plans[1]?.code ?? props.plans[0]?.code ?? "");
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [result, setResult] = useState<BillingResult | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<BillingResult>) =>
    start(async () => {
      setResult(await action());
    });

  const disabled = !props.canEdit || !props.configured || pending;
  const isCurrent = (code: string) => props.subscribed && code === props.currentPlanCode && cycle === props.currentCycle;

  return (
    <div className="grid gap-4 text-sm">
      {!props.configured ? <p className="text-destructive">A cobrança ainda não está configurada neste servidor (ASAAS_API_KEY).</p> : null}
      {!props.canEdit ? <p className="text-muted-foreground">Só o dono da conta pode assinar, trocar ou cancelar.</p> : null}

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Forma de cobrança">
        {(["MONTHLY", "YEARLY"] as const).map((c) => (
          <Button key={c} type="button" size="sm" variant={cycle === c ? "default" : "outline"} onClick={() => setCycle(c)} aria-pressed={cycle === c}>
            {c === "MONTHLY" ? "Mensal" : "Anual (economize)"}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {props.plans.map((plan) => {
          const selected = planCode === plan.code;
          return (
            <button
              key={plan.code}
              type="button"
              onClick={() => setPlanCode(plan.code)}
              aria-pressed={selected}
              className={cn(
                "grid content-start gap-1 rounded-lg border p-3 text-left transition-colors",
                selected ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <span className="font-semibold">
                {plan.name} {isCurrent(plan.code) ? <span className="text-xs font-normal text-primary">(seu plano)</span> : null}
              </span>
              <span>
                <span className="text-lg font-semibold">{brl(cycle === "YEARLY" ? plan.annualPriceCents : plan.priceCents)}</span>
                {cycle === "YEARLY" ? "/ano" : "/mês"}
              </span>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {!props.subscribed ? (
        <div className="grid gap-3 rounded-lg border p-3">
          {!props.hasCustomer ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="bill-name">Nome completo ou razão social</Label>
                <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bill-doc">CPF ou CNPJ</Label>
                <Input id="bill-doc" value={document} onChange={(e) => setDocument(e.target.value)} maxLength={20} inputMode="numeric" />
                <p className="text-xs text-muted-foreground">Vai só para o Asaas emitir a cobrança; guardamos apenas os 4 últimos dígitos.</p>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Você paga na página do Asaas com Pix, boleto ou cartão (os dados do cartão não passam pelo nosso sistema). No teste
            grátis, a primeira cobrança vence no fim do teste.
          </p>
          <Button type="button" disabled={disabled || !planCode} className="w-fit" onClick={() => run(() => subscribeAction({ planCode, cycle, name, document }))}>
            {pending ? "Criando..." : "Assinar este plano"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={disabled || isCurrent(planCode) || props.hasPendingChange}
            onClick={() => run(() => changePlanAction({ planCode, cycle }))}
          >
            Trocar para este plano
          </Button>
          {props.hasPendingChange ? (
            <Button type="button" variant="outline" disabled={disabled} onClick={() => run(cancelPlanChangeAction)}>
              Desistir da troca
            </Button>
          ) : null}
          {confirmCancel ? (
            <>
              <Button type="button" variant="destructive" disabled={disabled} onClick={() => run(cancelSubscriptionAction)}>
                Confirmar cancelamento
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => setConfirmCancel(true)}>
              Cancelar assinatura
            </Button>
          )}
        </div>
      )}
      {props.subscribed ? (
        <p className="text-xs text-muted-foreground">
          Subir de plano: paga a diferença proporcional dos dias restantes e o plano novo libera quando ela for paga. Descer ou
          trocar entre mensal e anual: vale no próximo vencimento. Cancelar: sem nova cobrança, você usa até o fim do período
          pago.
        </p>
      ) : null}

      <div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run(refreshBillingAction)}>
          Atualizar situação com o Asaas
        </Button>
      </div>

      {result ? (
        <div role="status" className={result.ok ? "grid gap-2 text-green-700" : "text-destructive"}>
          <p>{result.ok ? result.message : result.error}</p>
          {result.ok && result.invoiceUrl ? (
            <a href={result.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 font-medium underline underline-offset-4">
              Abrir a cobrança no Asaas <ExternalLinkIcon className="size-4" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
