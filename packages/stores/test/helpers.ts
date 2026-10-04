// Respostas simuladas (nenhum teste chama as lojas de verdade).
export function shopeeNode(itemId: number, extra: Record<string, unknown> = {}) {
  return {
    itemId,
    productName: `Fone Bluetooth ${itemId}`,
    imageUrl: `https://cf.shopee.com.br/file/${itemId}`,
    priceMin: "59.90",
    priceMax: "79.90",
    priceDiscountRate: 40,
    commissionRate: "0.08",
    commission: "4.79",
    sales: 12500,
    ratingStar: "4.8",
    productLink: `https://shopee.com.br/product/111/${itemId}`,
    offerLink: `https://s.shopee.com.br/CENTRAL${itemId}`,
    productCatIds: [100, 200],
    ...extra,
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const graphqlOffers = (nodes: unknown[]) =>
  json({ data: { productOfferV2: { nodes, pageInfo: { page: 1, limit: 50, hasNextPage: false } } } });

export const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

export const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

/** fetch falso: responde por URL; registra as chamadas. */
export function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const handler = routes[url] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) throw new Error(`fetch inesperado: ${url}`);
    return handler();
  }) as typeof fetch;
  return { fetch: fn, calls };
}
