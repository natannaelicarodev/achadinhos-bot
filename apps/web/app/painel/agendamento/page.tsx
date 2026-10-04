import { ComingSoon, PageHeader } from "@/components/painel/page-header";

export default function AgendamentoPage() {
  return (
    <>
      <PageHeader title="Agendamento" description="Fila de envios para seus grupos." />
      <ComingSoon phase="fase de agendamento" />
    </>
  );
}
