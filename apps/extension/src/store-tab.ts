// Faz os pedidos à loja DE DENTRO de uma aba da loja (como o próprio site faz),
// para a loja reconhecer a origem e a sessão do usuário (ML: portal de afiliados;
// Amazon: SiteStripe). Usa uma aba da loja já aberta; se não houver, abre uma em
// segundo plano e fecha depois.
import { AFFILIATE_HUB_URL } from "./ml";

export interface StoreSite {
  /** Padrão das abas da loja que servem (chrome.tabs.query). */
  tabPattern: string;
  /** Página aberta em segundo plano quando não há aba da loja. */
  openUrl: string;
}

export const ML_SITE: StoreSite = { tabPattern: "https://www.mercadolivre.com.br/*", openUrl: AFFILIATE_HUB_URL };
export const AMAZON_SITE: StoreSite = { tabPattern: "https://www.amazon.com.br/*", openUrl: "https://www.amazon.com.br/" };
/** Painel de Associados da Amazon (relatórios). */
export const ASSOCIATES_SITE: StoreSite = {
  tabPattern: "https://associados.amazon.com.br/*",
  openUrl: "https://associados.amazon.com.br/p/reporting/earnings",
};

const TAB_LOAD_TIMEOUT_MS = 20_000;

interface PageFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface PageFetchResult {
  status: number;
  url: string;
  text: string;
}

/** Roda DENTRO da aba da loja (é serializada pelo Chrome: não pode usar nada de fora). */
async function pageFetch(url: string, init: PageFetchInit): Promise<PageFetchResult> {
  const response = await fetch(url, { ...init, credentials: "include", redirect: "follow" });
  return { status: response.status, url: response.url, text: await response.text() };
}

function waitForTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("A aba da loja demorou para abrir."));
    }, TAB_LOAD_TIMEOUT_MS);
    function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
      if (id !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Aba "emprestada" durante uma sequência de pedidos (holdStoreTab): evita abrir uma aba por pedido. */
const heldTabs = new Map<StoreSite, number>();

/** `fresh`: ignora abas já abertas e abre uma nova (página recém-carregada = sessão nova). */
async function withStoreTab<T>(site: StoreSite, task: (tabId: number) => Promise<T>, options: { fresh?: boolean } = {}): Promise<T> {
  const held = heldTabs.get(site);
  if (held !== undefined) return task(held);
  if (!options.fresh) {
    const [existing] = await chrome.tabs.query({ url: site.tabPattern, status: "complete" });
    if (existing?.id !== undefined) return task(existing.id);
  }

  const created = await chrome.tabs.create({ url: site.openUrl, active: false });
  if (created.id === undefined) throw new Error("Não foi possível abrir a loja.");
  try {
    await waitForTab(created.id);
    return await task(created.id);
  } finally {
    await chrome.tabs.remove(created.id).catch(() => undefined);
  }
}

/**
 * Roda vários pedidos na MESMA aba da loja (abre uma em segundo plano só se não houver).
 * `fresh`: sempre abre uma aba nova em segundo plano (e fecha no fim).
 */
export async function holdStoreTab<T>(site: StoreSite, task: () => Promise<T>, options: { fresh?: boolean } = {}): Promise<T> {
  if (heldTabs.has(site)) return task();
  return withStoreTab(
    site,
    async (tabId) => {
      heldTabs.set(site, tabId);
      try {
        return await task();
      } finally {
        heldTabs.delete(site);
      }
    },
    options,
  );
}

/**
 * fetch compatível (subconjunto) que executa dentro de uma aba da loja.
 * Serve para as funções de ml.ts / amazon.ts sem mudar nada nelas.
 */
export function fetchFromStoreTab(site: StoreSite): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const pageInit: PageFetchInit = {
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    };
    const result = await withStoreTab(site, async (tabId) => {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: pageFetch, args: [url, pageInit] });
      if (!injection?.result) throw new Error("Não foi possível executar o pedido na aba da loja.");
      return injection.result as PageFetchResult;
    });
    const response = new Response(result.text, { status: result.status });
    Object.defineProperty(response, "url", { value: result.url });
    return response;
  };
}

export const fetchFromMlTab = fetchFromStoreTab(ML_SITE);
export const fetchFromAmazonTab = fetchFromStoreTab(AMAZON_SITE);
export const fetchFromAssociatesTab = fetchFromStoreTab(ASSOCIATES_SITE);
export const holdMlTab = <T>(task: () => Promise<T>) => holdStoreTab(ML_SITE, task);

/** Roda DENTRO da aba e de cada quadro (serializada pelo Chrome): procura o csrf-token e o pageState. */
async function readAssociatesDom(): Promise<{ csrfToken: string; pageState: string; diag: string }> {
  let csrfToken = "";
  let pageState = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? "";
    pageState = (document.getElementById("pageState") ?? document.querySelector("[data-page-state]"))?.getAttribute("data-page-state") ?? "";
    if (csrfToken && pageState) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const diag = `${location.host}${location.pathname} "${document.title.slice(0, 40)}" csrf:${csrfToken ? "sim" : "não"} pageState:${pageState ? "sim" : "não"}`;
  return { csrfToken, pageState, diag };
}

/**
 * Sessão do Associados lida da página JÁ CARREGADA (o pageState é montado pelo JavaScript
 * da página; o HTML baixado não tem). Procura em todos os quadros da aba do Associados
 * (usa a aberta ou abre uma). Sem sessão: devolve o que viu em cada quadro (diagnóstico).
 */
export async function readAssociatesDomFromTab(): Promise<{ csrfToken: string; pageState: string } | { diag: string }> {
  return withStoreTab(ASSOCIATES_SITE, async (tabId) => {
    const injections = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readAssociatesDom });
    const results = injections
      .map((i) => i.result as { csrfToken: string; pageState: string; diag: string } | undefined)
      .filter((r): r is { csrfToken: string; pageState: string; diag: string } => Boolean(r));
    const csrfToken = results.find((r) => r.csrfToken)?.csrfToken ?? "";
    const pageState = results.find((r) => r.pageState)?.pageState ?? "";
    if (csrfToken && pageState) return { csrfToken, pageState };
    return { diag: results.map((r) => r.diag).join(" | ") || "nenhum quadro respondeu" };
  });
}
