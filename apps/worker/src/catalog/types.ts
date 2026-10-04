import type { MinedProduct, Store } from "@achadinhos/db";

export type MinerStatus = { enabled: true } | { enabled: false; reason: string };

/** Resultado da mineração de uma loja. `failures`: buscas que falharam (as demais seguiram). */
export interface MineResult {
  products: MinedProduct[];
  requests: number;
  failures: number;
}

/**
 * Minerador de uma loja para o catálogo central. Usa a credencial CENTRAL do
 * sistema, só para ler produtos. Nunca gera nem devolve link de afiliado.
 */
export interface CatalogMiner {
  readonly store: Store;
  status(): MinerStatus;
  /** Busca os produtos de destaque (mais vendidos, melhor avaliados, maior comissão). */
  mine(): Promise<MineResult>;
  /** Reconfere produtos pelo id na loja: null = a loja não devolveu mais (saiu do catálogo). */
  verify(externalIds: string[]): Promise<Map<string, MinedProduct | null>>;
}
