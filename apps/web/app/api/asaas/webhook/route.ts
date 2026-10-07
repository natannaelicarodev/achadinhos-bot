// Webhook do Asaas (fase 9): cobranças pagas, vencidas, estornadas... atualizam a assinatura.
// Configure no Asaas: URL {APP_URL}/api/asaas/webhook e o token igual ao ASAAS_WEBHOOK_TOKEN.
import { asaasFromEnv, createMailer, handleWebhookEvent, isValidWebhookToken, notifyAdminsOfReview, webhookEventSchema } from "@achadinhos/billing";
import { getPrisma } from "@achadinhos/db";

const MAX_BODY_BYTES = 256 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  if (!isValidWebhookToken(request.headers.get("asaas-access-token"), process.env.ASAAS_WEBHOOK_TOKEN)) {
    return json({ error: "token inválido" }, 401);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "grande demais" }, 413);
  let parsed;
  try {
    parsed = webhookEventSchema.safeParse(JSON.parse(text));
  } catch {
    return json({ error: "formato inválido" }, 400);
  }
  // Formato que não entendemos: confirma o recebimento (o Asaas não fica reenviando para sempre).
  if (!parsed.success) return json({ ignored: true });
  try {
    const client = getPrisma();
    const send = createMailer();
    // A cobrança é lida de novo na API do Asaas antes de valer (aviso forjado não libera nada).
    const outcome = await handleWebhookEvent(
      { client, asaas: asaasFromEnv(), notify: (notice) => notifyAdminsOfReview(client, send, notice).then(() => undefined) },
      parsed.data,
    );
    return json({ outcome });
  } catch {
    // Erro nosso (ex.: banco fora): 500 para o Asaas tentar de novo.
    return json({ error: "falha ao processar" }, 500);
  }
}
