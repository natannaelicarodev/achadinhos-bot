import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS, sessionCookieOptions } from "@/lib/auth/cookie";

// Checagem rápida (só presença do cookie). A validação real da sessão
// acontece no layout do painel, no servidor.
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { pathname, search } = request.nextUrl;

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
