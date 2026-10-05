// Service worker da extensão: recebe pedidos SÓ do content script do painel
// (origens permitidas no build) e fala com o Mercado Livre usando a sessão do navegador.
import { handleRequest } from "./handlers";
import { readBestsellers } from "./amazon";
import { AUTOPILOT_LINKS_EVERY_MINUTES, syncAutopilotLinks } from "./autopilot-links";
import { ML_REPORT_RANGES, readMlReport, type MlReportSnapshot } from "./ml-report";
import { AMAZON_REPORT_RANGES, readAmazonReport, sessionFromParts, type AmazonReportSnapshot } from "./amazon-report";

const REPORTS_ENDPOINT_PATH = "/api/extension/reports";
import {
  AMAZON_SITE,
  ASSOCIATES_SITE,
  fetchFromAmazonTab,
  fetchFromAssociatesTab,
  fetchFromMlTab,
  holdMlTab,
  holdStoreTab,
  readAssociatesDomFromTab,
} from "./store-tab";
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
/** Relatório do ML (cliques, vendas, ganho) de hora em hora, com a mesma chave. */
const REPORTS_ALARM = "ml-reports";
const REPORTS_EVERY_MINUTES = 60;
let reportsRunning = false;
/** Cada loja tem até 60 s: aba que não abre ou página que não responde não trava as próximas rodadas. */
const REPORT_STEP_TIMEOUT_MS = 60_000;
function withTimeout<T>(task: Promise<T>, store: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${store} demorou demais para responder (mais de 60 s). Deixe a página da loja aberta e logada neste Chrome.`)),
      REPORT_STEP_TIMEOUT_MS,
    );
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function runReports(): Promise<void> {
  const { config } = await loadAutopilot();
  if (!config || reportsRunning) return;
  reportsRunning = true;
  let result: { ok: boolean; message: string };
  try {
    const now = Date.now();
    const auth = { authorization: `Bearer ${config.token}` };
    // O painel diz quais lojas o cliente configurou (e a etiqueta da Amazon).
    const setup = await fetch(new URL(REPORTS_ENDPOINT_PATH, config.endpoint).toString(), { headers: auth });
    if (!setup.ok) throw new Error(`O painel recusou (HTTP ${setup.status}).`);
    const { mercadoLivre, amazonStoreId } = (await setup.json()) as { mercadoLivre?: boolean; amazonStoreId?: string | null };
    const snapshots: (MlReportSnapshot | AmazonReportSnapshot)[] = [];
    const parts: string[] = [];
    if (mercadoLivre) {
      try {
        const ml = await withTimeout(
          holdMlTab(async () => {
            const list = [];
            for (const range of ML_REPORT_RANGES) list.push(await readMlReport(fetchFromMlTab, range, now));
            return list;
          }),
          "Mercado Livre",
        );
        snapshots.push(...ml);
        parts.push(`Mercado Livre: ${ml.find((x) => x.rangeDays === 30)?.clicks ?? 0} cliques em 30 dias`);
      } catch (error) {
        parts.push(`Mercado Livre: ${error instanceof Error ? error.message : "falha"}`);
      }
    }
    if (amazonStoreId) {
      try {
        const amz = await withTimeout(holdStoreTab(ASSOCIATES_SITE, async () => {
          const list = [];
          // Sessão (csrf + token da página do Associados) lida uma vez e usada nos dois períodos.
          // O pageState é montado pelo JavaScript da página: lê da aba já carregada.
          const dom = await readAssociatesDomFromTab();
          if ("diag" in dom) {
            throw new Error(`Não achei a sua sessão na página do Associados (vi: ${dom.diag}). Entre na sua conta de Associados neste Chrome.`);
          }
          const session = sessionFromParts(dom.csrfToken, dom.pageState);
          for (const range of AMAZON_REPORT_RANGES) {
            list.push(await readAmazonReport(fetchFromAssociatesTab, amazonStoreId, range, now, session));
          }
          return list;
        }), "Amazon");
        snapshots.push(...amz);
        parts.push(`Amazon: ${amz.find((x) => x.rangeDays === 30)?.clicks ?? 0} cliques em 30 dias`);
      } catch (error) {
        parts.push(`Amazon: ${error instanceof Error ? error.message : "falha"}`);
      }
    }
    if (snapshots.length > 0) {
      const response = await fetch(new URL(REPORTS_ENDPOINT_PATH, config.endpoint).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ snapshots }),
      });
      if (!response.ok) throw new Error(`O painel recusou o relatório (HTTP ${response.status}).`);
    }
    result = {
      ok: snapshots.length > 0 && parts.every((p) => !/falha|Entre|não abriu|inesperado/i.test(p)),
      message: parts.length > 0 ? `${parts.join(" · ")}.` : "Nenhuma loja com relatório configurada (Credenciais).",
    };
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : "Falha ao ler o relatório do Mercado Livre." };
  } finally {
    reportsRunning = false;
  }
  await chrome.storage.local.set({ reportsState: { lastRunAt: new Date().toISOString(), lastResult: result } });
}
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
  const stored = await chrome.storage.local.get("reportsState");
  const reports = (stored.reportsState as { lastRunAt: string | null; lastResult: AutopilotLinkStatus["lastResult"] } | undefined) ?? null;
  return {
    enabled: Boolean(config),
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    reportsLastRunAt: reports?.lastRunAt ?? null,
    reportsLastResult: reports?.lastResult ?? null,
  };
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
    await chrome.alarms.clear(REPORTS_ALARM);
    await chrome.storage.local.remove("reportsState");
    return autopilotStatus();
  }
  await chrome.storage.local.set({ autopilotConfig: { token: payload.token, endpoint: origin } satisfies AutopilotConfig });
  await chrome.alarms.create(AUTOPILOT_ALARM, { periodInMinutes: AUTOPILOT_LINKS_EVERY_MINUTES });
  await chrome.alarms.create(REPORTS_ALARM, { periodInMinutes: REPORTS_EVERY_MINUTES });
  void runReports();
  void runAutopilotLinks();
  return autopilotStatus();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runVitrine();
  if (alarm.name === AUTOPILOT_ALARM) void runAutopilotLinks();
  if (alarm.name === REPORTS_ALARM) void runReports();
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
