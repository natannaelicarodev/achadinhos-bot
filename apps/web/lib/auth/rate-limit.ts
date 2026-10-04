// Limite de tentativas em memória (um processo). Vai para o Redis quando houver mais de uma instância.
const buckets = new Map<string, { count: number; resetAt: number }>();

/** true se a ação está liberada; false se estourou o limite na janela. */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
