// Domínio dos links curtos (SHORT_LINK_BASE_URL) separado do painel (APP_URL).
// No domínio curto só /o/[codigo] responde; o resto (login, /painel, ...) vai para o APP_URL.
// Sem pacotes de Node: roda no proxy (middleware) do Next.

export const SHORT_LINK_PATH = "/o/";

/** Host com porta; 127.0.0.1 e [::1] contam como localhost (o Next trata os três como o mesmo endereço). */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(127\.0\.0\.1|\[::1\])(?=:|$)/, "localhost");
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHost(new URL(url).host);
  } catch {
    return null;
  }
}

/** Base dos links curtos: SHORT_LINK_BASE_URL, ou o próprio APP_URL. */
export function shortLinkBase(env: Record<string, string | undefined> = process.env): string {
  const base = env.SHORT_LINK_BASE_URL?.trim() || env.APP_URL?.trim() || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

/**
 * null = segue normal; string = redirecionar para esse endereço do painel.
 * Só age quando o domínio curto é DIFERENTE do domínio do painel.
 */
export function shortDomainRedirect(requestUrl: URL, host: string | null, env: Record<string, string | undefined> = process.env): string | null {
  const shortHost = hostOf(env.SHORT_LINK_BASE_URL?.trim());
  const appUrl = env.APP_URL?.trim();
  const appHost = hostOf(appUrl);
  if (!shortHost || !appUrl || !appHost || shortHost === appHost) return null;
  if (normalizeHost(host ?? requestUrl.host) !== shortHost) return null;
  if (requestUrl.pathname.startsWith(SHORT_LINK_PATH)) return null;
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, appUrl).toString();
}
