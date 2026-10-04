"use client";

import type { AffiliateStore } from "@achadinhos/stores";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const HELP: Record<AffiliateStore, { title: string; steps: string[]; portal: { label: string; url: string } }> = {
  SHOPEE: {
    title: "Credenciais da Shopee",
    steps: [
      "Entre no portal de afiliados da Shopee com a sua conta de afiliado.",
      "Abra a área Open API (às vezes aparece como Integração ou API) e solicite o acesso, se ainda não tiver.",
      "Depois de aprovado, copie o AppID (só números) e a Senha da API (Secret).",
      "Cole aqui e clique em Salvar e testar.",
    ],
    portal: { label: "Portal de afiliados da Shopee", url: "https://affiliate.shopee.com.br" },
  },
  AMAZON: {
    title: "Credenciais da Amazon",
    steps: [
      "Entre no Associados Amazon (Programa de Afiliados da Amazon Brasil).",
      "Em Gerenciar IDs de rastreamento, copie a sua tag (ex.: minhaloja-20).",
      "Opcional: a API de Criadores (Ferramentas > Creators API) só é liberada depois de 10 vendas aprovadas em 30 dias. Sem ela, os links funcionam normalmente só com a tag.",
    ],
    portal: { label: "Associados Amazon", url: "https://associados.amazon.com.br" },
  },
  MERCADO_LIVRE: {
    title: "Credenciais do Mercado Livre",
    steps: [
      "Entre no portal de Afiliados do Mercado Livre.",
      "Gere o link de afiliado de qualquer produto (pode ser o link curto meli.la).",
      "Cole o link aqui e clique em Ler link: o sistema preenche a Etiqueta (matt_word) e o ID da Ferramenta (matt_tool).",
      "Confira e clique em Salvar.",
    ],
    portal: { label: "Afiliados Mercado Livre", url: "https://www.mercadolivre.com.br/afiliados" },
  },
  SHEIN: {
    title: "Credenciais da Shein",
    steps: [
      "No app ou site da Shein, abra o Programa de Afiliados (pesquise por \"afiliado\").",
      "Gere o link de afiliado de um produto (onelink.shein.com ou br.shein.com).",
      "Cole o link aqui e clique em Ler: o sistema encontra o seu ID (url_from=affiliate_koc_...). Se preferir, digite o ID direto.",
    ],
    portal: { label: "Programa de afiliados da Shein", url: "https://br.shein.com" },
  },
};

export function CredentialHelp({ store }: { store: AffiliateStore }) {
  const [open, setOpen] = useState(false);
  const help = HELP[store];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted-foreground underline underline-offset-4">
        Como obter minhas credenciais
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{help.title}</DialogTitle>
            <DialogDescription>Passo a passo</DialogDescription>
          </DialogHeader>
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            {help.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <a href={help.portal.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline underline-offset-4">
            Abrir {help.portal.label}
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
