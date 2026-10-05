// Gera a extensão (dist/) e o .zip que o painel oferece para download.
// Origens do painel: http://localhost:3000 + APP_URL do .env (produção).
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { EXTENSION_VERSION } from "./src/protocol";

const root = dirname(fileURLToPath(import.meta.url));
const rootEnv = join(root, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const dist = join(root, "dist");
const downloads = join(root, "../web/public/downloads");
export const ZIP_NAME = "achadinhos-extensao.zip";

function panelOrigins(): string[] {
  const origins = new Set(["http://localhost:3000"]);
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) origins.add(new URL(appUrl).origin);
  return [...origins];
}

/** Padrão de URL do manifest (sem porta: o Chrome não aceita porta nos padrões). */
const matchPattern = (origin: string) => {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
};

const origins = panelOrigins();
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { background: join(root, "src/background.ts"), content: join(root, "src/content.ts") },
  bundle: true,
  outdir: dist,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  define: { __PANEL_ORIGINS__: JSON.stringify(origins) },
});

const manifest = {
  manifest_version: 3,
  name: "Achadinhos Bot",
  version: EXTENSION_VERSION,
  description:
    "Gera seus links de afiliado do Mercado Livre e da Amazon e lê o preço real do produto usando a sua sessão do navegador, para o painel Achadinhos Bot.",
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: [...new Set(origins.map(matchPattern))], js: ["content.js"], run_at: "document_start" }],
  // Painel: só para a vitrine compartilhada enviar os produtos (extensão do administrador).
  host_permissions: [
    "https://www.mercadolivre.com.br/*",
    "https://*.mercadolivre.com.br/*",
    "https://meli.la/*",
    "https://www.amazon.com.br/*",
    ...new Set(origins.map(matchPattern)),
  ],
  // scripting: pedidos de dentro de uma aba do ML. storage + alarms: vitrine de hora em hora.
  permissions: ["scripting", "storage", "alarms"],
};
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

// .zip com a pasta "achadinhos-extensao/" (o usuário descompacta e carrega no Chrome).
const files: Record<string, Uint8Array> = {};
for (const name of readdirSync(dist)) files[`achadinhos-extensao/${name}`] = readFileSync(join(dist, name));
mkdirSync(downloads, { recursive: true });
writeFileSync(join(downloads, ZIP_NAME), zipSync(files, { level: 9 }));

console.log(`[extensão] v${EXTENSION_VERSION} gerada para: ${origins.join(", ")}`);
