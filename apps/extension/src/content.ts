// Ponte página do painel <-> extensão. Só roda nas origens do painel (manifest)
// e só aceita mensagens da própria janela, no formato do protocolo. A validação
// completa do conteúdo é feita no service worker (background.ts).
import { EXTENSION_SOURCE, EXTENSION_VERSION, isPanelMessage } from "./constants";

type Result = { ok: true; data: unknown } | { ok: false; error: string };

function reply(id: string, result: Result) {
  window.postMessage({ source: EXTENSION_SOURCE, id, result }, location.origin);
}

const RELOADED = "A extensão foi atualizada ou recarregada. Atualize a página (F5) e tente de novo.";

// Depois de recarregar a extensão (↻), este script antigo continua na página mas
// perde a ligação: chrome.runtime.id some e sendMessage lança erro na hora
// ("Extension context invalidated"). Responde o aviso em vez de quebrar.
const extensionAlive = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin || !isPanelMessage(event.data)) return;
  const { id, type, payload } = event.data;
  if (!extensionAlive()) return reply(id, { ok: false, error: RELOADED });
  try {
    chrome.runtime
      .sendMessage({ type, payload })
      .then((result: Result) => reply(id, result))
      .catch(() => reply(id, { ok: false, error: RELOADED }));
  } catch {
    reply(id, { ok: false, error: RELOADED });
  }
});

// Avisa o painel que a extensão está instalada (o painel também pode perguntar com "ping").
reply("hello", { ok: true, data: { version: EXTENSION_VERSION } });
