// Lógica dos pedidos (testável sem Chrome: recebe fetch por parâmetro).
import { EXTENSION_VERSION, parseRequest, type ExtensionResult, type RequestPayload, type RequestType, type ResponseMap } from "./protocol";
import { createMeliLink, fetchCsrfToken, MlError, readMlProductInfo } from "./ml";

type Fetch = typeof fetch;

/** Token de proteção em memória por alguns minutos (evita abrir o portal a cada link). */
let csrfCache: { token: string; expiresAt: number } | undefined;
const CSRF_TTL_MS = 10 * 60_000;

export function resetCsrfCache() {
  csrfCache = undefined;
}

async function csrfToken(http: Fetch, now: number, force = false): Promise<string> {
  if (!force && csrfCache && csrfCache.expiresAt > now) return csrfCache.token;
  const { token } = await fetchCsrfToken(http);
  csrfCache = { token, expiresAt: now + CSRF_TTL_MS };
  return token;
}

const message = (error: unknown) =>
  error instanceof MlError ? error.message : "Não foi possível falar com o Mercado Livre agora. Tente de novo.";

/** No diagnóstico, mostra também o código HTTP e o erro técnico (sem dados da sessão). */
const detail = (error: unknown) => {
  if (error instanceof MlError) return error.status ? `${error.message} (HTTP ${error.status})` : error.message;
  return `${message(error)} [${error instanceof Error ? error.message.slice(0, 120) : "erro"}]`;
};

async function diagnose(http: Fetch, payload: RequestPayload<"ml.diagnose">): Promise<ResponseMap["ml.diagnose"]> {
  const steps: ResponseMap["ml.diagnose"]["steps"] = [];
  let token: string | null = null;
  try {
    const found = await fetchCsrfToken(http);
    token = found.token;
    steps.push({ step: "Sessão e token de proteção", ok: true, detail: `encontrado (${found.pattern})` });
  } catch (error) {
    steps.push({ step: "Sessão e token de proteção", ok: false, detail: detail(error) });
  }
  if (token) {
    try {
      const { shortUrl } = await createMeliLink(http, payload.productUrl, payload.tag, token);
      steps.push({ step: "Gerar meli.la", ok: true, detail: shortUrl });
    } catch (error) {
      steps.push({ step: "Gerar meli.la", ok: false, detail: detail(error) });
    }
  }
  try {
    const info = await readMlProductInfo(http, payload.productUrl);
    steps.push({
      step: "Ler preço da página",
      ok: Boolean(info.priceCents),
      detail: info.priceCents ? `R$ ${(info.priceCents / 100).toFixed(2)}${info.title ? ` · ${info.title.slice(0, 60)}` : ""}` : "preço não encontrado",
    });
  } catch (error) {
    steps.push({ step: "Ler preço da página", ok: false, detail: detail(error) });
  }
  return { steps };
}

export async function handleRequest(
  type: RequestType,
  rawPayload: unknown,
  deps: { fetch: Fetch; now?: () => number },
): Promise<ExtensionResult<RequestType>> {
  const parsed = parseRequest(type, rawPayload);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const now = deps.now ?? Date.now;
  try {
    switch (type) {
      case "ping":
        return { ok: true, data: { version: EXTENSION_VERSION } };
      case "ml.createLink": {
        const { productUrl, tag } = parsed.payload as RequestPayload<"ml.createLink">;
        try {
          return { ok: true, data: await createMeliLink(deps.fetch, productUrl, tag, await csrfToken(deps.fetch, now())) };
        } catch (error) {
          // Token vencido: busca um novo e tenta mais uma vez.
          if (!(error instanceof MlError) || !/recusou/.test(error.message)) throw error;
          return { ok: true, data: await createMeliLink(deps.fetch, productUrl, tag, await csrfToken(deps.fetch, now(), true)) };
        }
      }
      case "ml.productInfo": {
        const { productUrl } = parsed.payload as RequestPayload<"ml.productInfo">;
        return { ok: true, data: await readMlProductInfo(deps.fetch, productUrl) };
      }
      case "ml.diagnose":
        return { ok: true, data: await diagnose(deps.fetch, parsed.payload as RequestPayload<"ml.diagnose">) };
    }
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
