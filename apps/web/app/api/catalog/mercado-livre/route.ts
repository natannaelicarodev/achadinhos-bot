// Recebe a vitrine do Mercado Livre enviada pela extensão do ADMINISTRADOR
// (vitrine compartilhada) e grava no catálogo central. Autenticação: ML_VITRINE_TOKEN.
import { getPrisma, saveMinedProducts } from "@achadinhos/db";
import { isValidVitrineToken, vitrinePayloadSchema, vitrineToMinedProducts } from "@/lib/ml-vitrine";

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  if (!isValidVitrineToken(request.headers.get("authorization"), process.env.ML_VITRINE_TOKEN)) {
    return json({ error: "Chave da vitrine inválida. Ative de novo na página Extensão do painel." }, 401);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Envio grande demais." }, 413);

  let parsed;
  try {
    parsed = vitrinePayloadSchema.safeParse(JSON.parse(text));
  } catch {
    return json({ error: "Formato inválido." }, 400);
  }
  if (!parsed.success) return json({ error: "Formato inválido." }, 400);

  const products = vitrineToMinedProducts(parsed.data);
  const prisma = getPrisma();
  const startedAt = new Date();
  try {
    const { upserted, deactivated } = await saveMinedProducts(prisma, products, startedAt);
    await prisma.catalogMiningRun.create({
      data: {
        store: "MERCADO_LIVRE",
        status: "SUCCESS",
        fetched: products.length,
        upserted,
        deactivated,
        message: "Vitrine enviada pela extensão do administrador.",
        startedAt,
        finishedAt: new Date(),
      },
    });
    return json({ upserted });
  } catch (error) {
    await prisma.catalogMiningRun
      .create({
        data: {
          store: "MERCADO_LIVRE",
          status: "FAILED",
          fetched: products.length,
          message: `Falha ao gravar a vitrine: ${error instanceof Error ? error.message.slice(0, 200) : "erro"}`,
          startedAt,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
    return json({ error: "Não foi possível gravar os produtos agora." }, 500);
  }
}
