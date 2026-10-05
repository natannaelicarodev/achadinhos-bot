// Extensão do CLIENTE -> relatórios do Mercado Livre e da Amazon (cliques, vendas, ganho; 7 e 30 dias).
// Autenticação: chave pessoal da extensão (Bearer), a mesma do piloto automático.
import { getPrisma, getStoreCredentialSecrets } from "@achadinhos/db";
import { amazonSecretsSchema, mercadoLivreSecretsSchema } from "@achadinhos/stores";
import { authenticateExtension } from "@/lib/extension-autopilot";
import { reportsPayloadSchema, saveReportSnapshots } from "@/lib/store-reports";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  const prisma = getPrisma();
  const now = new Date();
  const auth = await authenticateExtension(prisma, request.headers.get("authorization"), now);
  if (!auth) return json({ error: "Chave da extensão inválida. Ligue de novo na página Extensão do painel." }, 401);
  const text = await request.text();
  if (text.length > 20_000) return json({ error: "Envio grande demais." }, 413);
  let parsed;
  try {
    parsed = reportsPayloadSchema.safeParse(JSON.parse(text));
  } catch {
    return json({ error: "Formato inválido." }, 400);
  }
  if (!parsed.success) return json({ error: "Formato inválido." }, 400);
  return json({ saved: await saveReportSnapshots(prisma, auth.tenantId, parsed.data, now) });
}

/** Quais relatórios ler: ML se tiver credencial; Amazon com a etiqueta (store id) do cliente. */
export async function GET(request: Request) {
  const prisma = getPrisma();
  const auth = await authenticateExtension(prisma, request.headers.get("authorization"), new Date());
  if (!auth) return json({ error: "Chave da extensão inválida. Ligue de novo na página Extensão do painel." }, 401);
  const [ml, amazon] = await Promise.all([
    getStoreCredentialSecrets(auth.tenantId, "MERCADO_LIVRE", { client: prisma }),
    getStoreCredentialSecrets(auth.tenantId, "AMAZON", { client: prisma }),
  ]);
  const amazonParsed = amazonSecretsSchema.safeParse(amazon);
  return json({
    mercadoLivre: mercadoLivreSecretsSchema.safeParse(ml).success,
    amazonStoreId: amazonParsed.success ? amazonParsed.data.tag : null,
  });
}
