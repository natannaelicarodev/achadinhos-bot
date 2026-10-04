import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Carrega o .env da raiz do monorepo (se existir).
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@achadinhos/db"],
  // Indicador do modo dev no canto direito (no esquerdo cobre o "Sair" da sidebar).
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
