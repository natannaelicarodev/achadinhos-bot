import { describe, expect, it } from "vitest";
import {
  captionProvider,
  CATEGORY_HEADLINES,
  chooseHeadline,
  DISCOUNT_HEADLINE_MIN_PCT,
  DISCOUNT_HEADLINES,
  findProductType,
  GENERIC_HEADLINE_KEY,
  GENERIC_HEADLINES,
  isDiscountHeadline,
  PRODUCT_TYPES,
  titleGender,
  withHeadlineKeys,
} from "../src/headlines";

/** Sorteio previsível: percorre a lista em ordem. */
const seq = () => {
  let i = 0;
  return () => ((i++ * 0.37) % 1);
};
const typeOf = (key: string) => PRODUCT_TYPES.find((t) => t.key === key)!;

describe("dicionário", () => {
  it("tem 150 a 200 tipos, cada um com palavras-chave e 3 a 5 headlines em maiúsculas com emoji no fim", () => {
    expect(PRODUCT_TYPES.length).toBeGreaterThanOrEqual(150);
    expect(PRODUCT_TYPES.length).toBeLessThanOrEqual(200);
    const keys = new Set<string>();
    for (const t of PRODUCT_TYPES) {
      expect(keys.has(t.key), t.key).toBe(false);
      keys.add(t.key);
      expect(t.keywords.length, t.key).toBeGreaterThan(0);
      expect(t.headlines.length, t.key).toBeGreaterThanOrEqual(3);
      expect(t.headlines.length, t.key).toBeLessThanOrEqual(5);
      for (const h of [...t.headlines, ...(t.feminine ?? []), ...(t.masculine ?? [])]) {
        expect(h, t.key).toBe(h.toUpperCase());
        expect(h, t.key).toMatch(/\p{Extended_Pictographic}️?$/u);
      }
    }
  });

  it("desconto: a partir de 60%, pelo menos 6 headlines diferentes", () => {
    expect(DISCOUNT_HEADLINE_MIN_PCT).toBe(60);
    expect(new Set(DISCOUNT_HEADLINES).size).toBeGreaterThanOrEqual(6);
  });

  it("saúde e beleza: nenhuma promessa de cura, alívio, tratamento ou resultado", () => {
    const forbidden = /\b(CURA|CURAR|ALIVIO|ALÍVIO|TRATAMENTO|TRATA|ACABA COM|ADEUS|EMAGREC|SECA|ELIMINA|RESULTADO|MILAGR)/;
    const lists = PRODUCT_TYPES.filter((t) => t.category === "HEALTH" || t.category === "BEAUTY").flatMap((t) => [
      ...t.headlines,
      ...(t.feminine ?? []),
      ...(t.masculine ?? []),
    ]);
    for (const h of [...lists, ...CATEGORY_HEADLINES.HEALTH, ...CATEGORY_HEADLINES.BEAUTY]) expect(h).not.toMatch(forbidden);
  });

  it("headlines neutras: sem ELA/ELE nem ♀️/♂️ fora das listas de gênero", () => {
    const all = [...PRODUCT_TYPES.flatMap((t) => t.headlines), ...Object.values(CATEGORY_HEADLINES).flat(), ...GENERIC_HEADLINES];
    for (const h of all) {
      // "SEM ELE" (o produto) é neutro; o que não pode é falar de uma pessoa com gênero.
      expect(h).not.toMatch(/\b(PARA ELA|PARA ELE|DELA|DELE|FEMININ|MASCULIN|MULHER|HOMEM)/);
      expect(h).not.toMatch(/[♀♂]/u);
    }
  });
});

describe("classificação por títulos reais", () => {
  it.each([
    ["Fone de Ouvido Bluetooth JBL Tune 520BT", "type:fone"],
    ["Whey Protein Sabor Chocolate 900g", "type:whey"],
    ["Creatina Pura Dark Lab Monohidratada", "type:creatina"],
    ["Air Fryer Mondial 4L Preta", "type:airfryer"],
    ["Panela de Pressão Elétrica 6L", "type:panelas"],
    ["Kaiak Masculino Desodorante Colônia 100ml", "type:perfume"],
    ["Relogio Smartwatch Feminino Masculino Series 10", "type:smartwatch"],
    ["Monitor De Glicose Kit Completo", "type:saude-aparelho"],
    ["Petisco Pet para Cachorro Biscoito", "type:petisco"],
  ])("%s -> %s", (title, key) => {
    expect(captionProvider.classify({ title, category: "OTHER" })).toBe(key);
  });

  it("especificidade: vence a palavra que aparece primeiro; empate fica com a mais longa", () => {
    // "Cabo" vem antes de "Carregador" e vice-versa.
    expect(findProductType("Cabo USB-C Carregador Rápido")?.key).toBe("cabo");
    expect(findProductType("Carregador Turbo com Cabo USB-C")?.key).toBe("carregador");
    // "tênis de corrida" (mais longa) ganha de "tênis" na mesma posição.
    expect(findProductType("Tênis de Corrida Masculino Leve")?.key).toBe("tenis-corrida");
    // Plural simples e acento.
    expect(findProductType("Kit 3 Panelas Antiaderentes")?.key).toBe("panelas");
  });

  it("sem tipo: cai na categoria e, sem categoria, na genérica", () => {
    expect(captionProvider.classify({ title: "Produto Misterioso XPTO", category: "PETS" })).toBe("category:PETS");
    expect(captionProvider.classify({ title: "Produto Misterioso XPTO", category: "OTHER" })).toBe(GENERIC_HEADLINE_KEY);
    expect(captionProvider.classify({ title: "Produto Misterioso XPTO" })).toBe(GENERIC_HEADLINE_KEY);
  });

  it("withHeadlineKeys preenche a chave antes de gravar no catálogo", () => {
    const [p] = withHeadlineKeys([{ title: "Fone Bluetooth", category: "ELECTRONICS" as const, headlineKey: null }]);
    expect(p!.headlineKey).toBe("type:fone");
  });

  it.each([
    "Barata Francesinha Armadilha Adesiva Kit 10",
    "Armadilha Cola Para Rato e Barata",
    "Inseticida Spray SBP Multi",
    "Ratoeira de Metal Reforçada",
    "Repelente Elétrico Tomada Raid",
    "Cupinicida Para Madeira 1L",
    "Formicida Isca Gel Formigas",
  ])("controle de pragas: %s", (title) => {
    expect(captionProvider.classify({ title, category: "PETS" })).toBe("type:controle-pragas");
  });

  it('"barata" de preço ("mais barata", "opção barata") não é controle de pragas', () => {
    expect(captionProvider.classify({ title: "Kit Opção Barata Fone Bluetooth" })).toBe("type:fone");
    expect(captionProvider.classify({ title: "A Versão Mais Barata", category: "PETS" })).toBe("category:PETS");
    expect(
      captionProvider.classify({ title: "Areia de Gato Mandioca Com Petisco MAIS BARATA Areia de Gato", category: "PETS" }),
    ).toBe("type:areia-gato");
    // Mais barata no começo, inseto depois: vale o inseto.
    expect(captionProvider.classify({ title: "Mais barata: armadilha para baratas" })).toBe("type:controle-pragas");
  });

  it("repelente corporal fica em Saúde (o de tomada vai para Casa)", () => {
    const [body] = withHeadlineKeys([{ title: "Repelente para Bebê SBP Baby Loção Corporal", category: "HEALTH" as const }]);
    expect(body).toMatchObject({ headlineKey: "type:repelente-corporal", category: "HEALTH" });
    expect(captionProvider.classify({ title: "Repelente Elétrico Tomada Raid" })).toBe("type:controle-pragas");
  });

  it("categoria do tipo corrige a da loja (armadilha para barata vinda de Pets -> Casa)", () => {
    const [trap] = withHeadlineKeys([{ title: "Armadilha Para Barata Kit 10", category: "PETS" as const }]);
    expect(trap).toMatchObject({ headlineKey: "type:controle-pragas", category: "HOME_KITCHEN_DECOR", categoryFromType: true });
    // Sem tipo: categoria da loja fica.
    const [other] = withHeadlineKeys([{ title: "Produto Misterioso XPTO", category: "PETS" as const }]);
    expect(other).toMatchObject({ headlineKey: "category:PETS", category: "PETS" });
    expect("categoryFromType" in other!).toBe(false);
    expect(captionProvider.categoryOf("category:PETS")).toBeNull();
    expect(captionProvider.categoryOf("generic")).toBeNull();
  });
});

describe("gênero", () => {
  it("só feminino/mulher ou masculino/homem ativam; os dois juntos = neutro", () => {
    expect(titleGender("Calça Jeans Masculina")).toBe("M");
    expect(titleGender("Perfume para Mulher")).toBe("F");
    expect(titleGender("Relogio Feminino Masculino")).toBeNull();
    expect(titleGender("Calça Jeans Skinny")).toBeNull();
  });

  it("headline com gênero só entra quando o título diz", () => {
    const calca = typeOf("calca");
    const neutral = captionProvider.candidates("type:calca", { title: "Calça Jeans Skinny" });
    expect(neutral).toEqual(calca.headlines);
    const male = captionProvider.candidates("type:calca", { title: "Calça Jeans Masculina" });
    expect(male).toEqual([...calca.headlines, ...calca.masculine!]);
    expect(male.some((h) => calca.feminine!.includes(h))).toBe(false);
  });
});

describe("escolha", () => {
  const product = { title: "Fone de Ouvido Bluetooth", category: "ELECTRONICS" as const, discountPct: 20 };

  it("não repete as 10 últimas do grupo: acabou o tipo, usa a categoria e depois as genéricas", () => {
    const key = captionProvider.classify(product);
    const recent: string[] = [];
    const random = seq();
    for (let i = 0; i < 30; i++) {
      const h = captionProvider.pick(key, product, { recent, random });
      expect(recent.slice(0, 10), `rodada ${i}`).not.toContain(h);
      recent.unshift(h);
    }
    const fone = typeOf("fone").headlines;
    expect(recent.some((h) => CATEGORY_HEADLINES.ELECTRONICS.includes(h))).toBe(true);
    expect(recent.some((h) => fone.includes(h))).toBe(true);
  });

  it("mesma mensagem para vários grupos: evita as 10 últimas de cada um", () => {
    const fone = typeOf("fone").headlines;
    const h = captionProvider.pick("type:fone", product, { recentByGroup: [fone.slice(0, 2), fone.slice(2)], random: () => 0 });
    expect(fone).not.toContain(h);
  });

  it("desconto só a partir de 60%", () => {
    expect(captionProvider.candidates("type:fone", { ...product, discountPct: 59 }).some(isDiscountHeadline)).toBe(false);
    const with60 = captionProvider.candidates("type:fone", { ...product, discountPct: 60 });
    expect(with60.filter(isDiscountHeadline)).toHaveLength(DISCOUNT_HEADLINES.length);
    expect(with60).toContain("60% OFF, PREÇO DE ERRO? 😱");
  });

  it("no máximo 1 headline de desconto a cada 3 posts do grupo", () => {
    const big = { ...product, discountPct: 75 };
    // Sorteio que sempre cai no fim da lista (onde ficam as de desconto).
    const last = () => 0.999;
    const recent: string[] = [];
    for (let i = 0; i < 12; i++) {
      const h = captionProvider.pick("type:fone", big, { recent, random: last });
      recent.unshift(h);
    }
    const flags = recent.map(isDiscountHeadline);
    expect(flags.some(Boolean)).toBe(true);
    for (let i = 0; i + 2 < flags.length; i++) {
      expect(flags.slice(i, i + 3).filter(Boolean).length, `posts ${i}..${i + 2}`).toBeLessThanOrEqual(1);
    }
  });

  it('"Quero outra headline": nunca devolve uma já vista enquanto houver opção', () => {
    const seen: string[] = [];
    const total = typeOf("fone").headlines.length + CATEGORY_HEADLINES.ELECTRONICS.length;
    for (let i = 0; i < total; i++) {
      const h = captionProvider.pick("type:fone", product, { exclude: seen });
      expect(seen).not.toContain(h);
      seen.push(h);
    }
  });
});

describe("configuração do cliente", () => {
  const product = { title: "Fone de Ouvido Bluetooth", category: "ELECTRONICS" as const, discountPct: null };

  it("automáticas desligadas e sem próprias: usa a fixa", () => {
    const settings = { headline: "🔥 ACHADINHO DO DIA", autoHeadlines: false, customHeadlines: [] };
    expect(chooseHeadline(settings, product)).toBe("🔥 ACHADINHO DO DIA");
  });

  it("automáticas desligadas com próprias: sorteia entre elas sem repetir as recentes", () => {
    const settings = { headline: "FIXA", autoHeadlines: false, customHeadlines: ["MINHA A 🔥", "MINHA B 🔥"] };
    expect(chooseHeadline(settings, product, { recent: ["MINHA A 🔥"] })).toBe("MINHA B 🔥");
    expect(chooseHeadline(settings, product, { exclude: ["MINHA B 🔥"] })).toBe("MINHA A 🔥");
  });

  it("automáticas ligadas: próprias entram no sorteio junto com as do tipo", () => {
    const settings = { headline: "FIXA", autoHeadlines: true, customHeadlines: ["MINHA HEADLINE 🔥"] };
    const fone = typeOf("fone").headlines;
    expect(chooseHeadline(settings, product, { exclude: fone })).toBe("MINHA HEADLINE 🔥");
    expect(chooseHeadline(settings, { ...product, headlineKey: "type:calca" }, { random: () => 0 })).toBe(typeOf("calca").headlines[0]);
  });
});
