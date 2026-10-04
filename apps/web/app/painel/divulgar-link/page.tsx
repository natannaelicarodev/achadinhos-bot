import { ComingSoon, PageHeader } from "@/components/painel/page-header";

// Fase 4b: o cliente cola o link de um produto (Mercado Livre, Shein, ...) e o
// sistema converte com a etiqueta de afiliado DELE.
export default function DivulgarLinkPage() {
  return (
    <>
      <PageHeader
        title="Divulgar link"
        description="Cole o endereço de um produto do Mercado Livre ou da Shein e o sistema converte com a sua etiqueta de afiliado."
      />
      <ComingSoon phase="próxima atualização (fase 4b)" />
    </>
  );
}
