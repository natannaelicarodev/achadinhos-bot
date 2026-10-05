// Constantes do protocolo sem dependências (usadas pela ponte, que roda em toda página do painel).
export const EXTENSION_VERSION = "0.4.0";
export const PANEL_SOURCE = "achadinhos-panel";
export const EXTENSION_SOURCE = "achadinhos-extension";
export const REQUEST_TYPES = ["ping", "ml.createLink", "ml.productInfo", "ml.diagnose", "ml.hubSearch",
  "amz.createLink", "amz.productInfo", "amz.diagnose", "vitrine.configure", "vitrine.status", "vitrine.runNow"] as const;

/** Formato mínimo de um pedido do painel (a validação completa é no service worker). */
export function isPanelMessage(data: unknown): data is { source: string; id: string; type: string; payload: unknown } {
  if (!data || typeof data !== "object") return false;
  const m = data as Record<string, unknown>;
  return (
    m.source === PANEL_SOURCE &&
    typeof m.id === "string" &&
    m.id.length > 0 &&
    m.id.length <= 64 &&
    typeof m.type === "string" &&
    (REQUEST_TYPES as readonly string[]).includes(m.type)
  );
}
