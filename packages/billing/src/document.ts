import { createHmac } from "node:crypto";
// CPF/CNPJ: validação dos dígitos. O número completo vai SÓ para o Asaas (não é gravado no nosso banco).

const digitsOf = (value: string) => value.replace(/\D/g, "");

function cpfValid(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}

function cnpjValid(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
}

/** CPF (11) ou CNPJ (14) válido -> só os dígitos; inválido -> null. */
export function parseDocument(value: string): string | null {
  const digits = digitsOf(value);
  if (digits.length === 11) return cpfValid(digits) ? digits : null;
  if (digits.length === 14) return cnpjValid(digits) ? digits : null;
  return null;
}

/** Os 4 últimos dígitos (o que fica guardado para mostrar no painel). */
export const documentLast4 = (digits: string) => digits.slice(-4);

/**
 * Impressão irreversível do CPF/CNPJ (HMAC-SHA256 com chave secreta): detecta o mesmo documento
 * em outra conta sem guardar o número. Sem a chave não dá para descobrir o documento.
 */
export function documentFingerprint(digits: string, secret: string): string {
  if (secret.length < 16) throw new Error("Chave da impressão do documento curta demais (BILLING_DOCUMENT_SECRET).");
  return createHmac("sha256", secret).update(`doc:${digits}`).digest("hex");
}
