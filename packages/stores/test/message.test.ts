import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE_TEMPLATE,
  messageVariables,
  parseWhatsappFormatting,
  renderMessage,
  validateTemplate,
} from "../src";

const product = { title: "Fone Bluetooth JBL", priceCents: 5990, originalPriceCents: 9990, discountPct: 40 };

describe("mensagem pronta", () => {
  it("template padrão completo", () => {
    const text = renderMessage(DEFAULT_MESSAGE_TEMPLATE, messageVariables(product, "https://s.shopee.com.br/abc", DEFAULT_HEADLINE));
    expect(text).toBe(
      [
        "*🔥 ACHADINHO DO DIA*",
        "Fone Bluetooth JBL",
        "40% DE DESCONTO",
        "De: ~R$ 99,90~",
        "Por: R$ 59,90",
        "Compre aqui: https://s.shopee.com.br/abc",
        "Promoção sujeita a alteração de preço e estoque do site",
      ].join("\n"),
    );
  });

  it("sem desconto e sem preço original: as linhas de desconto e 'De:' somem", () => {
    const text = renderMessage(
      DEFAULT_MESSAGE_TEMPLATE,
      messageVariables({ title: "Ração 10kg", priceCents: 12990, originalPriceCents: null, discountPct: null }, "https://x.com/l", "OFERTA"),
    );
    expect(text).not.toContain("DESCONTO");
    expect(text).not.toContain("De:");
    expect(text).toContain("Por: R$ 129,90");
  });

  it("desconto calculado pelos preços quando a loja não informa", () => {
    const vars = messageVariables({ title: "X", priceCents: 7500, originalPriceCents: 10000, discountPct: null }, "l", "h");
    expect(vars.desconto).toBe("25");
  });

  it("template do cliente: variável desconhecida fica como está", () => {
    expect(renderMessage("{titulo} {cupom}\n{link}", messageVariables(product, "L", "H"))).toBe("Fone Bluetooth JBL {cupom}\nL");
  });

  it("validação do template", () => {
    expect(validateTemplate(DEFAULT_MESSAGE_TEMPLATE)).toEqual([]);
    expect(validateTemplate("Sem link aqui")).toEqual(["O modelo precisa ter {link} (o link de afiliado)."]);
    expect(validateTemplate("")).toContain("O modelo não pode ficar vazio.");
  });

  it("formatação estilo WhatsApp para a prévia", () => {
    expect(parseWhatsappFormatting("De: ~R$ 99,90~ por *R$ 59,90*")).toEqual([
      { text: "De: " },
      { text: "R$ 99,90", bold: false, italic: false, strike: true },
      { text: " por " },
      { text: "R$ 59,90", bold: true, italic: false, strike: false },
    ]);
  });
});
