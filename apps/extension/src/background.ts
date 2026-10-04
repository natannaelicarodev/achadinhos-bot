// Service worker da extensão: recebe pedidos SÓ do content script do painel
// (origens permitidas no build) e fala com o Mercado Livre usando a sessão do navegador.
import { handleRequest } from "./handlers";
import { fetchFromMlTab } from "./ml-tab";
import { requestSchemas, type RequestType } from "./protocol";

declare const __PANEL_ORIGINS__: string[];
const allowedOrigins = new Set(__PANEL_ORIGINS__);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (sender.id !== chrome.runtime.id || !allowedOrigins.has(origin)) return false;

  const { type, payload } = (message ?? {}) as { type?: unknown; payload?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(requestSchemas, type)) {
    sendResponse({ ok: false, error: "Pedido desconhecido." });
    return false;
  }
  // Pedidos ao ML saem de dentro de uma aba do ML (origem e sessão reconhecidas pelo site).
  void handleRequest(type as RequestType, payload, { fetch: fetchFromMlTab }).then(sendResponse);
  return true; // resposta assíncrona
});
