// Faz os pedidos ao Mercado Livre DE DENTRO de uma aba do ML (como o portal faz),
// para o ML reconhecer a origem (www.mercadolivre.com.br) e a sessão do usuário.
// Usa uma aba do ML já aberta; se não houver, abre uma em segundo plano e fecha depois.
import { AFFILIATE_HUB_URL } from "./ml";

const ML_TAB_PATTERN = "https://www.mercadolivre.com.br/*";
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

/** Roda DENTRO da aba do ML (é serializada pelo Chrome: não pode usar nada de fora). */
async function pageFetch(url: string, init: PageFetchInit): Promise<PageFetchResult> {
  const response = await fetch(url, { ...init, credentials: "include", redirect: "follow" });
  return { status: response.status, url: response.url, text: await response.text() };
}

function waitForTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("A aba do Mercado Livre demorou para abrir."));
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

async function withMlTab<T>(task: (tabId: number) => Promise<T>): Promise<T> {
  const [existing] = await chrome.tabs.query({ url: ML_TAB_PATTERN, status: "complete" });
  if (existing?.id !== undefined) return task(existing.id);

  const created = await chrome.tabs.create({ url: AFFILIATE_HUB_URL, active: false });
  if (created.id === undefined) throw new Error("Não foi possível abrir o Mercado Livre.");
  try {
    await waitForTab(created.id);
    return await task(created.id);
  } finally {
    await chrome.tabs.remove(created.id).catch(() => undefined);
  }
}

/**
 * fetch compatível (subconjunto) que executa dentro de uma aba do ML.
 * Serve para as funções de ml.ts sem mudar nada nelas.
 */
export const fetchFromMlTab: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const pageInit: PageFetchInit = {
    ...(init?.method ? { method: init.method } : {}),
    ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
    ...(typeof init?.body === "string" ? { body: init.body } : {}),
  };
  const result = await withMlTab(async (tabId) => {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: pageFetch, args: [url, pageInit] });
    if (!injection?.result) throw new Error("Não foi possível executar o pedido na aba do Mercado Livre.");
    return injection.result as PageFetchResult;
  });
  const response = new Response(result.text, { status: result.status });
  Object.defineProperty(response, "url", { value: result.url });
  return response;
};
