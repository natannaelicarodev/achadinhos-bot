// E-mail transacional (SMTP: Resend em produção). Usado pelo painel e pelo worker.
// Sem SMTP_HOST (dev): só imprime no terminal.
import nodemailer from "nodemailer";
import { z } from "zod";
import { isVerifiedAdmin, parseAdminEmails, type PrismaClient } from "@achadinhos/db";
import type { BillingNotice } from "./flows";

const empty = (v: unknown) => (v === "" ? undefined : v);
const smtpSchema = z.object({
  SMTP_HOST: z.preprocess(empty, z.string().optional()),
  SMTP_PORT: z.preprocess(empty, z.coerce.number().int().positive().default(587)),
  SMTP_USER: z.preprocess(empty, z.string().optional()),
  SMTP_PASS: z.preprocess(empty, z.string().optional()),
  SMTP_FROM: z.preprocess(empty, z.string().default("Achadinhos Bot <nao-responda@localhost>")),
  APP_URL: z.preprocess(empty, z.string().default("http://localhost:3000")),
});

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (message: MailMessage) => Promise<void>;

/** Envio por SMTP (Resend: smtp.resend.com, porta 465, usuário "resend", senha = chave de API). */
export function createMailer(env: Record<string, string | undefined> = process.env): SendMail {
  const cfg = smtpSchema.parse(env);
  if (!cfg.SMTP_HOST) {
    return async (m) => {
      console.log(`[email] SMTP não configurado. Para ${m.to} — ${m.subject}\n${m.text}`);
    };
  }
  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    ...(cfg.SMTP_USER ? { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? "" } } : {}),
  });
  return async (m) => {
    await transporter.sendMail({ from: cfg.SMTP_FROM, to: m.to, subject: m.subject, text: m.text });
  };
}

/**
 * Avisa por e-mail TODOS os administradores confirmados (SYSTEM_ADMIN_EMAILS + e-mail confirmado)
 * sobre uma cobrança para revisar. Sem dados sensíveis: conta, cobrança e motivo.
 */
export async function notifyAdminsOfReview(
  client: PrismaClient,
  send: SendMail,
  notice: BillingNotice,
  env: Record<string, string | undefined> = process.env,
) {
  const list = env.SYSTEM_ADMIN_EMAILS;
  const emails = parseAdminEmails(list);
  if (emails.length === 0) return 0;
  const admins = (await client.user.findMany({ where: { email: { in: emails } }, select: { email: true, emailVerifiedAt: true } })).filter((u) =>
    isVerifiedAdmin(u, list),
  );
  const tenant = await client.tenant.findUnique({ where: { id: notice.tenantId }, select: { name: true } });
  const appUrl = smtpSchema.parse(env).APP_URL.replace(/\/+$/, "");
  for (const admin of admins) {
    await send({
      to: admin.email,
      subject: "Cobrança para revisar — Achadinhos Bot",
      text: [
        "Uma cobrança do Asaas NÃO liberou o plano e precisa de revisão.",
        "",
        `Conta: ${tenant?.name ?? notice.tenantId}`,
        `Cobrança no Asaas: ${notice.asaasPaymentId}`,
        `Motivo: ${notice.reason}`,
        "",
        `Veja em: ${appUrl}/painel/admin/cobrancas?filtro=revisar`,
      ].join("\n"),
    });
  }
  return admins.length;
}
