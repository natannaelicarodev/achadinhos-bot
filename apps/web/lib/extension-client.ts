// Navegador: conversa com a extensão Achadinhos (via window.postMessage).
import {
  EXTENSION_SOURCE,
  PANEL_SOURCE,
  type ExtensionResult,
  type RequestPayload,
  type RequestType,
} from "@achadinhos/extension/protocol";

interface ExtensionReply {
  source: string;
  id: string;
  result: ExtensionResult<RequestType>;
}

function isReply(data: unknown): data is ExtensionReply {
  return Boolean(data && typeof data === "object" && (data as { source?: unknown }).source === EXTENSION_SOURCE);
}

/** Envia um pedido à extensão e espera a resposta (ou erro em pt-BR se não houver extensão). */
export function callExtension<T extends RequestType>(
  type: T,
  payload: RequestPayload<T>,
  timeoutMs = 20_000,
): Promise<ExtensionResult<T>> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "A extensão não respondeu. Confira se ela está instalada e ativa, e atualize a página." });
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isReply(event.data) || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data.result as ExtensionResult<T>);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PANEL_SOURCE, id, type, payload }, window.location.origin);
  });
}

/** Versão da extensão instalada, ou null se não estiver instalada/ativa. */
export async function detectExtension(timeoutMs = 1_000): Promise<{ version: string } | null> {
  const result = await callExtension("ping", {}, timeoutMs);
  return result.ok ? result.data : null;
}
