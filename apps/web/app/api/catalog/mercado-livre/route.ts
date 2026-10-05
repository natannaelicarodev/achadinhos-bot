// Recebe a vitrine do Mercado Livre enviada pela extensão do ADMINISTRADOR
// (vitrine compartilhada) e grava no catálogo central. Autenticação: ML_VITRINE_TOKEN.
import { vitrinePayloadSchema, vitrineToMinedProducts } from "@/lib/ml-vitrine";
import { receiveVitrine } from "@/lib/vitrine-route";

export function POST(request: Request) {
  return receiveVitrine(request, {
    store: "MERCADO_LIVRE",
    label: "Vitrine do Mercado Livre",
    schema: vitrinePayloadSchema,
    toProducts: vitrineToMinedProducts,
  });
}
