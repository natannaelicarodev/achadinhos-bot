// Service worker da extensão: recebe pedidos SÓ do content script do painel
// (origens permitidas no build) e fala com o Mercado Livre usando a sessão do navegador.
import { handleRequest } from "./handlers";
import { readBestsellers } from "./amazon";
import { AUTOPILOT_LINKS_EVERY_MINUTES, syncAutopilotLinks } from "./autopilot-links";
import { AMAZON_SITE, fetchFromAmazonTab, fetchFromMlTab, holdMlTab, holdStoreTab } from "./store-tab";
import { parseRequest, requestSchemas, type HubItem, type RequestPayload, type RequestType, type VitrineStatus, type AutopilotLinkStatus } from "./protocol";
import {
  AMAZON_PAGES_PER_HOUR,
  AMAZON_VITRINE_ENDPOINT_PATH,
  BLOCK_COOLDOWN_MS,
  checkPageBudget,
  collectAmazonVitrine,
  collectVitrine,
  HourlyLimitError,
  isBlockError,
  ML_PAGES_PER_HOUR,
  postVitrine,
  RUN_NOW_MIN_INTERVAL_MS,
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
  /** Captcha/bloqueio: nada roda até este horário. */
  blockedUntil?: string | null;
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
  return {
    enabled: Boolean(config),
    endpoint: config?.endpoint ?? null,
    running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    blockedUntil: state.blockedUntil ?? null,
  };
}

const failure = (error: unknown) => (error instanceof Error ? error.message : "falha ao atualizar.");
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Conta cada página pedida (janela móvel de 60 min, guardada no navegador). */
function pageBudget(store: "ml" | "amazon", limit: number, label: string) {
  return async () => {
    const stored = await chrome.storage.local.get("vitrinePages");
    const pages = (stored.vitrinePages as Record<string, number[]> | undefined) ?? {};
    const now = Date.now();
    const check = checkPageBudget(pages[store] ?? [], now, limit);
    if (!check.ok) throw new HourlyLimitError(`${label}: limite de ${limit} páginas por hora atingido; continua na próxima rodada`);
    pages[store] = [...check.log, now];
    await chrome.storage.local.set({ vitrinePages: pages });
  };
}

async function runVitrine(): Promise<void> {
  const { config, state } = await loadVitrine();
  if (!config || running) return;
  const started = Date.now();
  // Captcha/bloqueio recente em qualquer loja: nada roda até passar 1 hora.
  if (state.blockedUntil && new Date(state.blockedUntil).getTime() > started) return;
  running = true;
  const parts: { ok: boolean; text: string }[] = [];
  let blockedUntil: string | null = null;
  const blocked = (store: string, error: unknown) => {
    const until = Date.now() + BLOCK_COOLDOWN_MS;
    blockedUntil = new Date(until).toISOString();
    parts.push({ ok: false, text: `${store}: ${failure(error)} Vitrine parada até ${hhmm(until)}` });
  };
  try {
    if (config.categories.length > 0 || (config.searches ?? []).length > 0) {
      try {
        const batches = await holdMlTab(() =>
          collectVitrine(
            async ({ category, search, offset, bestSeller }) => {
              const found = await handleRequest("ml.hubSearch", { search, category, bestSeller, offset }, { fetch: fetchFromMlTab });
              if (!found.ok) throw new Error(found.error);
              return (found.data as { items: HubItem[] }).items;
            },
            config.categories,
            { searches: config.searches ?? [], beforeRequest: pageBudget("ml", ML_PAGES_PER_HOUR, "Mercado Livre") },
          ),
        );
        const { upserted } = await postVitrine(fetch, config.endpoint, config.token, batches);
        parts.push({ ok: true, text: `Mercado Livre: ${upserted} produto(s)` });
      } catch (error) {
        if (isBlockError(error)) blocked("Mercado Livre", error);
        else parts.push({ ok: error instanceof HourlyLimitError, text: `Mercado Livre: ${failure(error)}` });
      }
    }
    const slugs = config.amazonCategories ?? [];
    // Bloqueio no ML: a Amazon também não roda (para TUDO).
    if (slugs.length > 0 && !blockedUntil) {
      try {
        const batches = await holdStoreTab(AMAZON_SITE, () =>
          collectAmazonVitrine((slug, page) => readBestsellers(fetchFromAmazonTab, slug, page), slugs, {
            beforeRequest: pageBudget("amazon", AMAZON_PAGES_PER_HOUR, "Amazon"),
          }),
        );
        const { upserted } = await postVitrine(fetch, config.endpoint, config.token, batches, AMAZON_VITRINE_ENDPOINT_PATH);
        parts.push({ ok: true, text: `Amazon: ${upserted} produto(s)` });
      } catch (error) {
        if (isBlockError(error)) blocked("Amazon", error);
        else parts.push({ ok: error instanceof HourlyLimitError, text: `Amazon: ${failure(error)}` });
      }
    }
  } finally {
    running = false;
  }
  const result: VitrineState["lastResult"] = {
    ok: parts.length > 0 && parts.every((p) => p.ok),
    message: parts.length > 0 ? `${parts.map((p) => p.text).join(" · ")}.` : "Nada configurado para atualizar.",
  };
  await chrome.storage.local.set({
    vitrineState: { lastRunAt: new Date(started).toISOString(), lastResult: result, blockedUntil },
  });
}

/** "Atualizar agora": só 15 min depois da última rodada, e nunca durante o bloqueio. */
async function runNow(): Promise<{ ok: true; data: VitrineStatus } | { ok: false; error: string }> {
  const { config, state } = await loadVitrine();
  if (!config) return { ok: false, error: "A vitrine não está ativada nesta extensão." };
  const now = Date.now();
  if (state.blockedUntil && new Date(state.blockedUntil).getTime() > now) {
    return { ok: false, error: `Vitrine parada por captcha/bloqueio até ${hhmm(new Date(state.blockedUntil).getTime())}.` };
  }
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  if (running) return { ok: false, error: "Já está atualizando agora." };
  if (now - last < RUN_NOW_MIN_INTERVAL_MS) {
    const minutes = Math.max(1, Math.ceil((RUN_NOW_MIN_INTERVAL_MS - (now - last)) / 60_000));
    return { ok: false, error: `Aguarde ${minutes} min: a última rodada foi há pouco.` };
  }
  void runVitrine();
  return { ok: true, data: { ...(await vitrineStatus()), running: true } };
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

// ---------- Piloto automático do cliente: meli.la dos produtos do ML ----------

const AUTOPILOT_ALARM = "autopilot-links";
interface AutopilotConfig {
  token: string;
  endpoint: string;
}
let autopilotRunning = false;

async function loadAutopilot() {
  const stored = await chrome.storage.local.get(["autopilotConfig", "autopilotState"]);
  return {
    config: (stored.autopilotConfig as AutopilotConfig | undefined) ?? null,
    state: (stored.autopilotState as Omit<AutopilotLinkStatus, "enabled"> | undefined) ?? { lastRunAt: null, lastResult: null },
  };
}

async function autopilotStatus(): Promise<AutopilotLinkStatus> {
  const { config, state } = await loadAutopilot();
  return { enabled: Boolean(config), lastRunAt: state.lastRunAt, lastResult: state.lastResult };
}

async function runAutopilotLinks(): Promise<void> {
  const { config } = await loadAutopilot();
  if (!config || autopilotRunning) return;
  autopilotRunning = true;
  let lastResult: AutopilotLinkStatus["lastResult"];
  try {
    const result = await syncAutopilotLinks(fetch, config.endpoint, config.token, async ({ store, productUrl, tag }) => {
      // Mesmos pedidos do modo manual: meli.la (portal do ML) ou link.amazon (SiteStripe).
      const created =
        store === "AMAZON"
          ? await handleRequest("amz.createLink", { productUrl, tag }, { fetch: fetchFromMlTab, amazonFetch: fetchFromAmazonTab })
          : await handleRequest("ml.createLink", { productUrl, tag }, { fetch: fetchFromMlTab });
      if (!created.ok) throw new Error(created.error);
      return (created.data as { shortUrl: string }).shortUrl;
    });
    lastResult = {
      ok: result.failed === 0,
      message:
        result.generated === 0 && result.failed === 0
          ? "Nenhum produto esperando link curto."
          : `${result.generated} link(s) curto(s) gerado(s) para o piloto${result.failed ? `, ${result.failed} com falha (tenta de novo no próximo minuto)` : ""}.`,
    };
  } catch (error) {
    lastResult = { ok: false, message: error instanceof Error ? error.message : "Falha ao falar com o painel." };
  } finally {
    autopilotRunning = false;
  }
  await chrome.storage.local.set({ autopilotState: { lastRunAt: new Date().toISOString(), lastResult } });
}

async function configureAutopilot(origin: string, payload: RequestPayload<"autopilot.configure">): Promise<AutopilotLinkStatus> {
  if (!payload.enabled || !payload.token) {
    await chrome.storage.local.remove(["autopilotConfig", "autopilotState"]);
    await chrome.alarms.clear(AUTOPILOT_ALARM);
    return autopilotStatus();
  }
  await chrome.storage.local.set({ autopilotConfig: { token: payload.token, endpoint: origin } satisfies AutopilotConfig });
  await chrome.alarms.create(AUTOPILOT_ALARM, { periodInMinutes: AUTOPILOT_LINKS_EVERY_MINUTES });
  void runAutopilotLinks();
  return autopilotStatus();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runVitrine();
  if (alarm.name === AUTOPILOT_ALARM) void runAutopilotLinks();
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

  if (type.startsWith("autopilot.")) {
    const parsed = parseRequest(type as RequestType, payload);
    if (!parsed.ok) {
      sendResponse(parsed);
      return false;
    }
    const task =
      type === "autopilot.configure"
        ? configureAutopilot(origin, parsed.payload as RequestPayload<"autopilot.configure">)
        : autopilotStatus();
    void task.then(
      (data) => sendResponse({ ok: true, data }),
      () => sendResponse({ ok: false, error: "Não foi possível acessar a configuração da extensão." }),
    );
    return true;
  }

  if (type.startsWith("vitrine.")) {
    const parsed = parseRequest(type as RequestType, payload);
    if (!parsed.ok) {
      sendResponse(parsed);
      return false;
    }
    if (type === "vitrine.runNow") {
      void runNow().then(sendResponse, () => sendResponse({ ok: false, error: "Não foi possível atualizar agora." }));
      return true;
    }
    const task =
      type === "vitrine.configure"
        ? configureVitrine(origin, parsed.payload as RequestPayload<"vitrine.configure">)
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
