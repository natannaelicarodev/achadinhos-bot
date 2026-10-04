import type { Metadata } from "next";
import { PageHeader } from "@/components/painel/page-header";
import { PasteLinkForm } from "./paste-form";

export const metadata: Metadata = { title: "Divulgar link — Achadinhos Bot" };

// O cliente cola o endereço de um produto (Mercado Livre, Shein, Shopee ou
// Amazon) e o sistema converte com a etiqueta de afiliado DELE.
export default function DivulgarLinkPage() {
  return (
    <>
      <PageHeader
        title="Divulgar link"
        description="Cole o endereço de um produto. O sistema identifica a loja, converte com a sua etiqueta de afiliado e monta a mensagem pronta."
      />
      <PasteLinkForm />
    </>
  );
}
