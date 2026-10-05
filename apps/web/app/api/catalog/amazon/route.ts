// Recebe os "Mais vendidos" da Amazon lidos pela extensão do ADMINISTRADOR
// (vitrine compartilhada) e grava no catálogo central. Autenticação: ML_VITRINE_TOKEN.
import { amazonVitrinePayloadSchema, amazonVitrineToMinedProducts } from "@/lib/amazon-vitrine";
import { receiveVitrine } from "@/lib/vitrine-route";

export function POST(request: Request) {
  return receiveVitrine(request, {
    store: "AMAZON",
    label: "Vitrine da Amazon",
    schema: amazonVitrinePayloadSchema,
    toProducts: amazonVitrineToMinedProducts,
  });
}
