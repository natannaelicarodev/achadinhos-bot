// Recebimento da vitrine compartilhada (extensão do ADMINISTRADOR -> catálogo central).
// Comum ao Mercado Livre e à Amazon: chave ML_VITRINE_TOKEN, limite de tamanho, zod,
// gravação em lote e registro da execução.
import { getPrisma, saveMinedProducts, type MinedProduct, type Store } from "@achadinhos/db";
import { withHeadlineKeys } from "@achadinhos/stores";
import type { z } from "zod";
import { isValidVitrineToken } from "./ml-vitrine";

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function receiveVitrine<S extends z.ZodType>(
  request: Request,
  options: { store: Store; label: string; schema: S; toProducts: (payload: z.infer<S>) => MinedProduct[] },
): Promise<Response> {
  if (!isValidVitrineToken(request.headers.get("authorization"), process.env.ML_VITRINE_TOKEN)) {
    return json({ error: "Chave da vitrine inválida. Ative de novo na página Extensão do painel." }, 401);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Envio grande demais." }, 413);

  let parsed;
  try {
    parsed = options.schema.safeParse(JSON.parse(text));
  } catch {
    return json({ error: "Formato inválido." }, 400);
  }
  if (!parsed.success) return json({ error: "Formato inválido." }, 400);

  const products = withHeadlineKeys(options.toProducts(parsed.data));
  const prisma = getPrisma();
  const startedAt = new Date();
  try {
    const { upserted, deactivated } = await saveMinedProducts(prisma, products, startedAt);
    await prisma.catalogMiningRun.create({
      data: {
        store: options.store,
        status: "SUCCESS",
        fetched: products.length,
        upserted,
        deactivated,
        message: `${options.label} enviada pela extensão do administrador.`,
        startedAt,
        finishedAt: new Date(),
      },
    });
    return json({ upserted });
  } catch (error) {
    await prisma.catalogMiningRun
      .create({
        data: {
          store: options.store,
          status: "FAILED",
          fetched: products.length,
          message: `Falha ao gravar a ${options.label.toLowerCase()}: ${error instanceof Error ? error.message.slice(0, 200) : "erro"}`,
          startedAt,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
    return json({ error: "Não foi possível gravar os produtos agora." }, 500);
  }
}
