import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS, sessionCookieOptions } from "@/lib/auth/cookie";
import { shortDomainRedirect, SHORT_LINK_PATH } from "@/lib/short-domain";

// Checagem rápida (só presença do cookie). A validação real da sessão
// acontece no layout do painel, no servidor.
export function proxy(request: NextRequest) {
  // Domínio dos links curtos: só /o/[codigo]; o resto vai para o painel (APP_URL).
  const toApp = shortDomainRedirect(request.nextUrl, request.headers.get("host"));
  // Resposta montada à mão: NextResponse.redirect pode "encurtar" o endereço quando acha
  // que é a mesma origem (ex.: localhost x 127.0.0.1 no dev) e o navegador ficaria em loop.
  if (toApp) return new Response(null, { status: 308, headers: { location: toApp, "cache-control": "no-store" } });
  const { pathname, search } = request.nextUrl;
  // Link curto é público: sem cookie de sessão e sem renovação.
  if (pathname.startsWith(SHORT_LINK_PATH)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (pathname.startsWith("/painel") && !token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Renova a validade do cookie em navegação (cookies não podem ser
  // alterados em Server Components).
  if (token && request.method === "GET") {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(new Date(Date.now() + SESSION_DURATION_MS)),
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
