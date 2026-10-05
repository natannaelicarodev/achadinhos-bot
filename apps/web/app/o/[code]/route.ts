// Encurtador próprio: /o/[codigo] -> registra o clique e redireciona (302) para o link
// de afiliado do post. Rota PÚBLICA (sem login). Robôs de prévia não contam.
import { getPrisma } from "@achadinhos/db";
import { recordClick, safeRedirectTarget } from "@/lib/clicks";

const NOT_FOUND_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Link não encontrado</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Link não encontrado</h1><p>Esta oferta não existe mais ou o link está incompleto.</p></body></html>`;

const CODE = /^[A-Za-z0-9_-]{4,20}$/;

async function handle(request: Request, code: string): Promise<Response> {
  const notFound = () =>
    new Response(request.method === "HEAD" ? null : NOT_FOUND_HTML, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  if (!CODE.test(code)) return notFound();

  const prisma = getPrisma();
  const post = await prisma.post.findUnique({
    where: { shortCode: code },
    select: { id: true, tenantId: true, offerId: true, groupId: true, affiliateUrl: true, offer: { select: { affiliateUrl: true } } },
  });
  const target = safeRedirectTarget(post?.affiliateUrl ?? post?.offer.affiliateUrl);
  if (!post || !target) return notFound();

  // Falha ao registrar não pode impedir a pessoa de chegar na loja.
  await recordClick(prisma, post, request).catch((error: unknown) => console.error("[cliques] falha ao registrar", error));
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(request, (await params).code);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(request, (await params).code);
}
