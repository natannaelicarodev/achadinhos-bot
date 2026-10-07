// Preço por ciclo e diferença proporcional da troca de plano (subir).
// Preço por ciclo: cyclePrice fica no @achadinhos/db (usado na conferência do valor pago).

/** Abaixo disso o Asaas não emite cobrança: o plano novo começa no próximo vencimento pago (nunca de graça). */
export const MIN_CHARGE_CENTS = 500;

/**
 * Diferença proporcional aos dias que faltam do período pago:
 * (preço novo - preço atual) x dias restantes / dias do período. Arredonda para o centavo.
 */
export function upgradeDifferenceCents(
  currentPriceCents: number,
  newPriceCents: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0 || newPriceCents <= currentPriceCents) return 0;
  const remaining = Math.min(total, Math.max(0, periodEnd.getTime() - now.getTime()));
  const days = (ms: number) => Math.ceil(ms / 86_400_000);
  return Math.round(((newPriceCents - currentPriceCents) * days(remaining)) / days(total));
}

/** Data do Asaas ("AAAA-MM-DD") no dia de São Paulo. */
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
export const asaasDay = (date: Date) => dayFormat.format(date);

export const centsToValue = (cents: number) => Math.round(cents) / 100;
export const valueToCents = (value: number) => Math.round(value * 100);
