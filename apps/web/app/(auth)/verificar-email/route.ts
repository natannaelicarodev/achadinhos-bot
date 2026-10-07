// Link do e-mail de confirmação: confirma e volta ao painel.
import { getPrisma } from "@achadinhos/db";
import { verifyEmailToken } from "@/lib/auth/email-verification";
import { getEnv } from "@/lib/env";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const base = getEnv().APP_URL;
  const result = token.length >= 20 && token.length <= 200 ? await verifyEmailToken(getPrisma(), token) : { ok: false };
  const to = new URL(result.ok ? "/painel?email=confirmado" : "/painel?email=link-invalido", base);
  return new Response(null, { status: 303, headers: { location: to.toString(), "cache-control": "no-store" } });
}
