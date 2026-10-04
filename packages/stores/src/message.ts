// Mensagem pronta para divulgar (formato WhatsApp: *negrito*, ~riscado~).

export const DEFAULT_HEADLINE = "🔥 ACHADINHO DO DIA";

export const DEFAULT_MESSAGE_TEMPLATE = [
  "*{headline}*",
  "{titulo}",
  "{desconto}% DE DESCONTO",
  "De: ~{preco_de}~",
  "Por: {preco_por}",
  "Compre aqui: {link}",
  "Promoção sujeita a alteração de preço e estoque do site",
].join("\n");

export const TEMPLATE_VARIABLES = ["headline", "titulo", "preco_de", "preco_por", "desconto", "link"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** "R$ 59,90" com espaço comum (o Intl usa espaço não separável). */
export const formatBRL = (cents: number) => brl.format(cents / 100).replace(/\s/g, " ");

export interface MessageProduct {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPct: number | null;
}

/** Valores das variáveis a partir do produto. Desconto calculado se só houver os dois preços. */
export function messageVariables(product: MessageProduct, link: string, headline: string): Record<TemplateVariable, string> {
  const hasOriginal = product.originalPriceCents !== null && product.priceCents !== null && product.originalPriceCents > product.priceCents;
  const discount =
    product.discountPct ??
    (hasOriginal ? Math.round((1 - product.priceCents! / product.originalPriceCents!) * 100) : null);
  return {
    headline: headline.trim(),
    titulo: product.title.trim(),
    preco_de: hasOriginal ? formatBRL(product.originalPriceCents!) : "",
    preco_por: product.priceCents !== null ? formatBRL(product.priceCents) : "",
    desconto: discount && discount > 0 ? String(discount) : "",
    link,
  };
}

/**
 * Preenche o template. Linha com variável sem valor some (ex.: sem desconto,
 * as linhas de desconto e "De:" não aparecem). Variável desconhecida fica como está.
 */
export function renderMessage(template: string, values: Record<TemplateVariable, string>): string {
  const lines = template.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const used = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
    const known = used.filter((v): v is TemplateVariable => (TEMPLATE_VARIABLES as readonly string[]).includes(v));
    if (known.some((v) => !values[v])) continue;
    out.push(line.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? values[name as TemplateVariable] : match)));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Erros de validação do template (pt-BR). Vazio = ok. */
export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  if (!template.trim()) errors.push("O modelo não pode ficar vazio.");
  if (template.length > 2000) errors.push("O modelo pode ter no máximo 2000 caracteres.");
  if (!template.includes("{link}")) errors.push("O modelo precisa ter {link} (o link de afiliado).");
  return errors;
}

export type WhatsappSegment = { text: string; bold?: boolean; italic?: boolean; strike?: boolean };

/** Quebra uma linha em trechos com *negrito*, _itálico_ e ~riscado~ (prévia estilo WhatsApp). */
export function parseWhatsappFormatting(line: string): WhatsappSegment[] {
  const segments: WhatsappSegment[] = [];
  const re = /([*_~])([^*_~\n]+?)\1/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index) });
    const mark = m[1];
    segments.push({ text: m[2]!, bold: mark === "*", italic: mark === "_", strike: mark === "~" });
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  return segments;
}
