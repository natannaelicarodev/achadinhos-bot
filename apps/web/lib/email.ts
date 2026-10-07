// E-mails do painel (SMTP: Resend em produção; sem SMTP_HOST no dev, o link aparece no terminal).
import { createMailer } from "@achadinhos/billing";

/** Envia o link de recuperação. */
export async function sendPasswordResetEmail(to: { email: string; name: string }, resetUrl: string) {
  await createMailer()({
    to: to.email,
    subject: "Redefinir sua senha — Achadinhos Bot",
    text: [
      `Olá, ${to.name}!`,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta.",
      `Para criar uma nova senha, acesse (válido por 1 hora): ${resetUrl}`,
      "",
      "Se não foi você, ignore este e-mail. Sua senha continua a mesma.",
    ].join("\n"),
  });
}

/** Envia o link de confirmação do e-mail (válido por 24 horas). */
export async function sendVerificationEmail(to: { email: string; name: string }, verifyUrl: string) {
  await createMailer()({
    to: to.email,
    subject: "Confirme seu e-mail — Achadinhos Bot",
    text: [
      `Olá, ${to.name}!`,
      "",
      "Para assinar um plano e enviar ofertas aos seus grupos, confirme o seu e-mail:",
      verifyUrl,
      "",
      "O link vale por 24 horas. Se não foi você que criou a conta, ignore este e-mail.",
    ].join("\n"),
  });
}
