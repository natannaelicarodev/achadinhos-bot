import nodemailer from "nodemailer";
import { getEnv } from "./env";

/** Envia o link de recuperação. Sem SMTP_HOST (dev), só imprime o link no terminal. */
export async function sendPasswordResetEmail(to: { email: string; name: string }, resetUrl: string) {
  const env = getEnv();
  const subject = "Redefinir sua senha — Achadinhos Bot";
  const text = [
    `Olá, ${to.name}!`,
    "",
    "Recebemos um pedido para redefinir a senha da sua conta.",
    `Para criar uma nova senha, acesse (válido por 1 hora): ${resetUrl}`,
    "",
    "Se não foi você, ignore este e-mail. Sua senha continua a mesma.",
  ].join("\n");

  if (!env.SMTP_HOST) {
    console.log(`[email] SMTP não configurado. Link de recuperação para ${to.email}:\n${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } } : {}),
  });
  await transporter.sendMail({ from: env.SMTP_FROM, to: to.email, subject, text });
}
