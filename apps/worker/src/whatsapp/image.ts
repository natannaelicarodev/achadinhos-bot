// Download da imagem da oferta por URL, com limites. Falhou? O envio segue só com texto.
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const IMAGE_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
} as const;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ImageResult = { ok: true; buffer: Buffer; mimetype: string } | { ok: false; reason: string };

export interface ImageDeps {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<{ address: string }[]>;
}

const defaultDeps: ImageDeps = {
  fetch: (...args) => fetch(...args),
  lookup: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
};

// Redes internas: o worker não pode ser usado para acessar a rede do Railway/localhost.
const privateRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped?.[1] ?? address;
  const family = isIP(ip);
  if (family === 0) return true;
  return privateRanges.check(ip, family === 4 ? "ipv4" : "ipv6");
}

async function hostIsPublic(hostname: string, deps: ImageDeps): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await deps.lookup(host);
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Confere a assinatura do arquivo (não confia só no Content-Type). */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const TOO_BIG = "A imagem tem mais de 5 MB.";
const BAD_TYPE = "Formato de imagem não suportado (use JPEG, PNG ou WebP).";

export async function loadImageFromUrl(rawUrl: string, deps: ImageDeps = defaultDeps): Promise<ImageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "O link da imagem é inválido." };
  }

  const signal = AbortSignal.timeout(IMAGE_LIMITS.timeoutMs);
  try {
    let response: Response | undefined;
    for (let hop = 0; hop <= IMAGE_LIMITS.maxRedirects; hop++) {
      if (url.protocol !== "https:") return { ok: false, reason: "O link da imagem precisa começar com https://." };
      if (!(await hostIsPublic(url.hostname, deps))) {
        return { ok: false, reason: "O endereço da imagem não é permitido." };
      }
      response = await deps.fetch(url, { signal, redirect: "manual", headers: { accept: "image/*" } });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url);
        response = undefined;
        continue;
      }
      break;
    }
    if (!response) return { ok: false, reason: "O link da imagem redireciona demais." };
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: `Não foi possível baixar a imagem (HTTP ${response.status}).` };
    }

    const declaredType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_TYPES.has(declaredType)) {
      await response.body?.cancel();
      return { ok: false, reason: BAD_TYPE };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > IMAGE_LIMITS.maxBytes) {
      await response.body?.cancel();
      return { ok: false, reason: TOO_BIG };
    }

    // Lê em partes e corta ao passar do limite (o Content-Length pode mentir).
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > IMAGE_LIMITS.maxBytes) {
          await response.body.cancel().catch(() => undefined);
          return { ok: false, reason: TOO_BIG };
        }
        chunks.push(chunk);
      }
    }
    const buffer = Buffer.concat(chunks);
    const realType = sniffImageType(buffer);
    if (!realType || !ALLOWED_TYPES.has(realType)) return { ok: false, reason: BAD_TYPE };
    return { ok: true, buffer, mimetype: realType };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, reason: "A imagem demorou mais de 10 segundos para baixar." };
    }
    return { ok: false, reason: "Não foi possível baixar a imagem." };
  }
}
