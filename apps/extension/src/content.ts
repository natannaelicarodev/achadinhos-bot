// Ponte página do painel <-> extensão. Só roda nas origens do painel (manifest)
// e só aceita mensagens da própria janela, no formato do protocolo. A validação
// completa do conteúdo é feita no service worker (background.ts).
import { EXTENSION_SOURCE, EXTENSION_VERSION, isPanelMessage } from "./constants";

type Result = { ok: true; data: unknown } | { ok: false; error: string };

function reply(id: string, result: Result) {
  window.postMessage({ source: EXTENSION_SOURCE, id, result }, location.origin);
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin || !isPanelMessage(event.data)) return;
  const { id, type, payload } = event.data;
  chrome.runtime
    .sendMessage({ type, payload })
    .then((result: Result) => reply(id, result))
    .catch(() =>
      reply(id, { ok: false, error: "A extensão foi atualizada ou recarregada. Atualize a página (F5) e tente de novo." }),
    );
});

// Avisa o painel que a extensão está instalada (o painel também pode perguntar com "ping").
reply("hello", { ok: true, data: { version: EXTENSION_VERSION } });
