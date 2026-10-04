import { describe, expect, it } from "vitest";
import { isPrivateAddress, loadImageFromUrl, sniffImageType, type ImageDeps } from "../src/whatsapp/image";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(4)]);

function deps(responder: (url: URL) => Response, addresses = ["93.184.216.34"]): ImageDeps {
  return {
    fetch: (async (input: string | URL | Request) => responder(new URL(String(input)))) as typeof fetch,
    lookup: async () => addresses.map((address) => ({ address })),
  };
}

const image = (body: Buffer, type: string, extra: Record<string, string> = {}) => () =>
  new Response(new Uint8Array(body), { status: 200, headers: { "content-type": type, ...extra } });

describe("imagem por URL", () => {
  it("baixa PNG, JPEG e WebP via https", async () => {
    for (const [body, type] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [WEBP, "image/webp"],
    ] as const) {
      const result = await loadImageFromUrl("https://cdn.loja.com/img", deps(image(body, type)));
      expect(result).toEqual({ ok: true, buffer: body, mimetype: type });
    }
  });

  it("recusa http (sem s)", async () => {
    const result = await loadImageFromUrl("http://cdn.loja.com/a.png", deps(image(PNG, "image/png")));
    expect(result).toEqual({ ok: false, reason: "O link da imagem precisa começar com https://." });
  });

  it("recusa tipos fora de jpeg/png/webp (pelo header e pelo conteúdo)", async () => {
    const gif = await loadImageFromUrl("https://x.com/a.gif", deps(image(Buffer.from("GIF89a"), "image/gif")));
    expect(gif.ok).toBe(false);
    const html = await loadImageFromUrl("https://x.com/a", deps(image(Buffer.from("<html>"), "image/png")));
    expect(html).toEqual({ ok: false, reason: "Formato de imagem não suportado (use JPEG, PNG ou WebP)." });
  });

  it("recusa mais de 5 MB (pelo Content-Length e pelo download real)", async () => {
    const declared = await loadImageFromUrl(
      "https://x.com/a.png",
      deps(image(PNG, "image/png", { "content-length": String(6 * 1024 * 1024) })),
    );
    expect(declared).toEqual({ ok: false, reason: "A imagem tem mais de 5 MB." });

    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const real = await loadImageFromUrl("https://x.com/a.png", deps(image(big, "image/png")));
    expect(real).toEqual({ ok: false, reason: "A imagem tem mais de 5 MB." });
  });

  it("timeout vira mensagem de 10 segundos", async () => {
    const timeout: ImageDeps = {
      fetch: (async () => {
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      }) as typeof fetch,
      lookup: async () => [{ address: "93.184.216.34" }],
    };
    expect(await loadImageFromUrl("https://x.com/a.png", timeout)).toEqual({
      ok: false,
      reason: "A imagem demorou mais de 10 segundos para baixar.",
    });
  });

  it("bloqueia endereços internos (localhost, rede privada, metadata)", async () => {
    for (const url of ["https://localhost/a.png", "https://127.0.0.1/a.png", "https://169.254.169.254/x"]) {
      expect((await loadImageFromUrl(url, deps(image(PNG, "image/png")))).ok).toBe(false);
    }
    const resolvesPrivate = await loadImageFromUrl("https://interno.com/a.png", deps(image(PNG, "image/png"), ["10.0.0.5"]));
    expect(resolvesPrivate).toEqual({ ok: false, reason: "O endereço da imagem não é permitido." });
  });

  it("segue redirect só para https público", async () => {
    const toHttp = deps((url) =>
      url.pathname === "/a"
        ? new Response(null, { status: 302, headers: { location: "http://x.com/b.png" } })
        : image(PNG, "image/png")(),
    );
    expect((await loadImageFromUrl("https://x.com/a", toHttp)).ok).toBe(false);

    const toHttps = deps((url) =>
      url.pathname === "/a"
        ? new Response(null, { status: 302, headers: { location: "/b.png" } })
        : image(PNG, "image/png")(),
    );
    expect((await loadImageFromUrl("https://x.com/a", toHttps)).ok).toBe(true);
  });

  it("HTTP de erro vira mensagem com o código", async () => {
    const notFound = deps(() => new Response("x", { status: 404 }));
    expect(await loadImageFromUrl("https://x.com/a.png", notFound)).toEqual({
      ok: false,
      reason: "Não foi possível baixar a imagem (HTTP 404).",
    });
  });
});

describe("auxiliares", () => {
  it("isPrivateAddress", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("192.168.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("fd12::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("sniffImageType", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(Buffer.from("GIF89a"))).toBeNull();
  });
});
