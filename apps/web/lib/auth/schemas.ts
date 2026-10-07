import { z } from "zod";
import { passwordSchema } from "./password";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Informe um e-mail válido.").max(254, "E-mail muito longo."));

export const signUpSchema = z.object({
  tenantName: z.string().trim().min(2, "Informe o nome do seu negócio.").max(80, "Nome muito longo."),
  name: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome muito longo."),
  email: emailSchema,
  password: passwordSchema,
  // Caixa "Li e aceito os Termos de uso" (fase 9): obrigatória.
  acceptTerms: z.literal("on", { message: "Para criar a conta, aceite os Termos de uso." }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha.").max(128),
});

export const requestResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Link inválido."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
