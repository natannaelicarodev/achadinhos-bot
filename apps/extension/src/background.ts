// Service worker da extensão: recebe pedidos SÓ do content script do painel
// (origens permitidas no build) e fala com o Mercado Livre usando a sessão do navegador.
import { handleRequest } from "./handlers";
import { readBestsellers } from "./amazon";
import { AMAZON_SITE, fetchFromAmazonTab, fetchFromMlTab, holdMlTab, holdStoreTab } from "./store-tab";
import { parseRequest, requestSchemas, type HubItem, type RequestPayload, type RequestType, type VitrineStatus } from "./protocol";
import {
  AMAZON_VITRINE_ENDPOINT_PATH,
  collectAmazonVitrine,
  collectVitrine,
  postVitrine,
  VITRINE_INTERVAL_MINUTES,
} from "./vitrine";

declare const __PANEL_ORIGINS__: string[];
const allowedOrigins = new Set(__PANEL_ORIGINS__);

// ---------- Vitrine compartilhada (só na extensão do administrador) ----------

const ALARM = "vitrine";
interface VitrineConfig {
  token: string;
  endpoint: string;
  categories: string[];
  searches?: string[];
  amazonCategories?: string[];
}
interface VitrineState {
  lastRunAt: string | null;
  lastResult: { ok: boolean; message: string } | null;
}

let running = false;

async function loadVitrine() {
  const stored = await chrome.storage.local.get(["vitrineConfig", "vitrineState"]);
  const config = (stored.vitrineConfig as VitrineConfig | undefined) ?? null;
  const state = (stored.vitrineState as VitrineState | undefined) ?? { lastRunAt: null, lastResult: null };
  return { config, state };
}

async function vitrineStatus(): Promise<VitrineStatus> {
  const { config, state } = await loadVitrine();
  return { enabled: Boolean(config), endpoint: config?.endpoint ?? null, running, ...state };
}

const failure = (error: unknown) => (error instanceof Error ? error.message : "falha ao atualizar.");

async function runVitrine(): Promise<void> {
  const { config } = await loadVitrine();
  if (!config || running) return;
  running = true;
  // Mercado Livre e Amazon independentes: falha numa loja não impede a outra.
  const parts: { ok: boolean; text: string }[] = [];
  try {
    if (config.categories.length > 0 || (config.searches ?? []).length > 0) {
      try {
        const batches = await holdMlTab(() =>
          collectVitrine(async ({ category, search, offset, bestSeller }) => {
            const found = await handleRequest("ml.hubSearch", { search, category, bestSeller, offset }, { fetch: fetchFromMlTab });
            if (!found.ok) throw new Error(found.error);
            return (found.data as { items: HubItem[] }).items;
          }, config.categories, { searches: config.searches ?? [] }),
        );
        const { upserted } = await postVitrine(fetch, config.endpoint, config.token, batches);
        parts.push({ ok: true, text: `Mercado Livre: ${upserted} produto(s)` });
      } catch (error) {
        parts.push({ ok: false, text: `Mercado Livre: ${failure(error)}` });
      }
    }
    const slugs = config.amazonCategories ?? [];
    if (slugs.length > 0) {
      try {
        const batches = await holdStoreTab(AMAZON_SITE, () =>
          collectAmazonVitrine((slug, page) => readBestsellers(fetchFromAmazonTab, slug, page), slugs),
        );
        const { upserted } = await postVitrine(fetch, config.endpoint, config.token, batches, AMAZON_VITRINE_ENDPOINT_PATH);
        parts.push({ ok: true, text: `Amazon: ${upserted} produto(s)` });
      } catch (error) {
        parts.push({ ok: false, text: `Amazon: ${failure(error)}` });
      }
    }
  } finally {
    running = false;
  }
  const result: VitrineState["lastResult"] = {
    ok: parts.length > 0 && parts.every((p) => p.ok),
    message: parts.length > 0 ? `${parts.map((p) => p.text).join(" · ")}.` : "Nada configurado para atualizar.",
  };
  await chrome.storage.local.set({ vitrineState: { lastRunAt: new Date().toISOString(), lastResult: result } });
}

async function configureVitrine(origin: string, payload: RequestPayload<"vitrine.configure">): Promise<VitrineStatus> {
  if (!payload.enabled || !payload.token) {
    await chrome.storage.local.remove(["vitrineConfig", "vitrineState"]);
    await chrome.alarms.clear(ALARM);
    return vitrineStatus();
  }
  const config: VitrineConfig = {
    token: payload.token,
    endpoint: origin,
    categories: payload.categories,
    searches: payload.searches,
    amazonCategories: payload.amazonCategories,
  };
  await chrome.storage.local.set({ vitrineConfig: config });
  await chrome.alarms.create(ALARM, { periodInMinutes: VITRINE_INTERVAL_MINUTES, delayInMinutes: VITRINE_INTERVAL_MINUTES });
  void runVitrine();
  return { ...(await vitrineStatus()), running: true };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runVitrine();
});

// ---------- Pedidos do painel ----------

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (sender.id !== chrome.runtime.id || !allowedOrigins.has(origin)) return false;

  const { type, payload } = (message ?? {}) as { type?: unknown; payload?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(requestSchemas, type)) {
    sendResponse({ ok: false, error: "Pedido desconhecido." });
    return false;
  }

  if (type.startsWith("vitrine.")) {
    const parsed = parseRequest(type as RequestType, payload);
    if (!parsed.ok) {
      sendResponse(parsed);
      return false;
    }
    const task =
      type === "vitrine.configure"
        ? configureVitrine(origin, parsed.payload as RequestPayload<"vitrine.configure">)
        : type === "vitrine.runNow"
          ? (void runVitrine(), vitrineStatus().then((s) => ({ ...s, running: s.enabled })))
          : vitrineStatus();
    void task.then(
      (data) => sendResponse({ ok: true, data }),
      () => sendResponse({ ok: false, error: "Não foi possível acessar a configuração da extensão." }),
    );
    return true;
  }

  // Pedidos ao ML saem de dentro de uma aba do ML (origem e sessão reconhecidas pelo site).
  void handleRequest(type as RequestType, payload, { fetch: fetchFromMlTab, amazonFetch: fetchFromAmazonTab }).then(sendResponse);
  return true; // resposta assíncrona
});
