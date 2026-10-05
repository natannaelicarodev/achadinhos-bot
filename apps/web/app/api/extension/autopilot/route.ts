// Extensão do CLIENTE <-> piloto automático (links curtos: meli.la e link.amazon).
// Autenticação: chave pessoal da extensão (Bearer), gerada na página Extensão.
import { getPrisma, getStoreCredentialSecrets } from "@achadinhos/db";
import {
  amazonSecretsSchema,
  canonicalAmazonShortLink,
  isAmazonShortLink,
  isMercadoLivreShortLink,
  isOwnAmazonLink,
  isOwnMercadoLivreLink,
  mercadoLivreSecretsSchema,
  parseHttpsUrl,
  resolveAmazonShortLink,
  resolveMercadoLivreShortLink,
  StoreUrlError,
} from "@achadinhos/stores";
import { applyShortLink, authenticateExtension, autopilotCallSchema, pendingShortLinks } from "@/lib/extension-autopilot";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  const prisma = getPrisma();
  const now = new Date();
  const auth = await authenticateExtension(prisma, request.headers.get("authorization"), now);
  if (!auth) return json({ error: "Chave da extensão inválida. Ligue de novo na página Extensão do painel." }, 401);

  const text = await request.text();
  if (text.length > 20_000) return json({ error: "Envio grande demais." }, 413);
  let body;
  try {
    body = autopilotCallSchema.safeParse(text ? JSON.parse(text) : {});
  } catch {
    return json({ error: "Formato inválido." }, 400);
  }
  if (!body.success) return json({ error: "Formato inválido." }, 400);

  const [mlSecrets, amazonSecrets] = await Promise.all([
    getStoreCredentialSecrets(auth.tenantId, "MERCADO_LIVRE", { client: prisma }),
    getStoreCredentialSecrets(auth.tenantId, "AMAZON", { client: prisma }),
  ]);
  const ml = mercadoLivreSecretsSchema.safeParse(mlSecrets);
  const amazon = amazonSecretsSchema.safeParse(amazonSecrets);

  // Confere no servidor que o link curto é do cliente (e, na Amazon, do mesmo produto).
  const verify = async (shortUrl: string, offer: { store: string; externalId: string | null }) => {
    const url = parseHttpsUrl(shortUrl);
    if (!url) return null;
    try {
      if (offer.store === "MERCADO_LIVRE" && isMercadoLivreShortLink(url) && ml.success) {
        const { tags } = await resolveMercadoLivreShortLink(url.toString());
        return isOwnMercadoLivreLink(tags, ml.data) ? `https://${url.hostname}${url.pathname}` : null;
      }
      if (offer.store === "AMAZON" && isAmazonShortLink(url) && amazon.success && offer.externalId) {
        const resolved = await resolveAmazonShortLink(url.toString());
        return isOwnAmazonLink(resolved, amazon.data, offer.externalId) ? canonicalAmazonShortLink(url) : null;
      }
      return null;
    } catch (error) {
      if (error instanceof StoreUrlError) return null;
      throw error;
    }
  };

  let applied = 0;
  let rejected = 0;
  for (const link of body.data.links) {
    const result = await applyShortLink(prisma, auth.tenantId, link, verify, now);
    if (result.ok) applied += result.posts;
    else rejected += 1;
  }
  return json({ applied, rejected, pending: await pendingShortLinks(prisma, auth.tenantId) });
}
