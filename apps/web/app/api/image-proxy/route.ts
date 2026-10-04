// Imagem do produto pela mesma origem (para "Copiar imagem").
// Só servidores de imagem das lojas, só usuário logado, até 5 MB.
import { getCurrentSession } from "@/lib/auth/current";

const IMAGE_HOSTS = [
  "cf.shopee.com.br",
  "susercontent.com", // down-br.img.susercontent.com (Shopee)
  "mlstatic.com", // http2.mlstatic.com (Mercado Livre)
  "media-amazon.com",
  "ssl-images-amazon.com",
  "ltwebstatic.com", // Shein
];
const MAX_BYTES = 5 * 1024 * 1024;

function allowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export async function GET(request: Request) {
  if (!(await getCurrentSession())) return new Response("Não autenticado.", { status: 401 });

  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return new Response("URL inválida.", { status: 400 });
  }
  if (!allowed(target)) return new Response("Imagem fora das lojas suportadas.", { status: 400 });

  const upstream = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) return new Response("Imagem indisponível.", { status: 502 });

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Imagem maior que 5 MB.", { status: 413 });
  return new Response(body, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
