"use client";

import { EXTENSION_VERSION, isOutdated, type ResponseMap } from "@achadinhos/extension/protocol";
import { CheckCircle2Icon, CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callExtension, detectExtension } from "@/lib/extension-client";

type Status = { state: "checking" } | { state: "missing" } | { state: "installed"; version: string };

export function ExtensionStatusBadge() {
  const [status, setStatus] = useState<Status>({ state: "checking" });
  useEffect(() => {
    void detectExtension().then((r) => setStatus(r ? { state: "installed", version: r.version } : { state: "missing" }));
  }, []);

  if (status.state === "checking") return <Badge variant="secondary">Verificando...</Badge>;
  if (status.state === "missing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleDashedIcon className="size-3" /> Não instalada (ou desativada)
      </Badge>
    );
  }
  if (isOutdated(status.version)) {
    return (
      <Badge variant="destructive" className="gap-1">
        <TriangleAlertIcon className="size-3" /> Versão {status.version}: baixe a {EXTENSION_VERSION}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-green-600 text-white">
      <CheckCircle2Icon className="size-3" /> Instalada (versão {status.version})
    </Badge>
  );
}

const DIAGNOSTIC = {
  ml: {
    label: "Mercado Livre",
    button: "Testar com o Mercado Livre",
    credential: "Configure primeiro a sua credencial do Mercado Livre (em Credenciais) para testar a extensão.",
    placeholder: "https://www.mercadolivre.com.br/...",
    hint: "O teste gera um link meli.la de verdade com a sua etiqueta (o Mercado Livre também adiciona o produto à sua lista de recomendados).",
  },
  amz: {
    label: "Amazon",
    button: "Testar com a Amazon",
    credential: "Configure primeiro a sua etiqueta da Amazon (em Credenciais) para testar a extensão.",
    placeholder: "https://www.amazon.com.br/.../dp/B0...",
    hint: "Entre na amazon.com.br com a sua conta de Associados neste Chrome (a barra SiteStripe aparece no topo dos produtos). O teste gera um link curto de verdade com a sua etiqueta.",
  },
} as const;

/** Endereço da Amazon -> https://www.amazon.com.br/dp/ASIN (o formato que a extensão aceita). */
function amazonProductUrl(raw: string): string {
  const asin = raw.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
  return asin ? `https://www.amazon.com.br/dp/${asin.toUpperCase()}` : raw.trim();
}

/** Testa a extensão com a loja: link curto (meli.la / SiteStripe) e leitura do preço. */
export function ExtensionDiagnostic({ store, tag }: { store: "ml" | "amz"; tag: string | null }) {
  const [url, setUrl] = useState("");
  const [steps, setSteps] = useState<ResponseMap["ml.diagnose"]["steps"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const text = DIAGNOSTIC[store];
  const inputId = `diag-url-${store}`;

  if (!tag) return <p className="text-sm text-muted-foreground">{text.credential}</p>;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>Endereço de um produto da loja {text.label}</Label>
        <Input id={inputId} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={text.placeholder} />
        <p className="text-xs text-muted-foreground">{text.hint}</p>
      </div>
      <Button
        className="w-fit"
        disabled={pending || !url.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            setSteps(null);
            const result =
              store === "ml"
                ? await callExtension("ml.diagnose", { productUrl: url.trim(), tag }, 45_000)
                : await callExtension("amz.diagnose", { productUrl: amazonProductUrl(url), tag }, 45_000);
            if (result.ok) setSteps(result.data.steps);
            else setError(result.error);
          })
        }
      >
        {pending ? "Testando..." : text.button}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {steps ? (
        <ul className="grid gap-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.step} className="flex gap-2">
              <span>{s.ok ? "✅" : "❌"}</span>
              <span>
                <strong>{s.step}:</strong> {s.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
