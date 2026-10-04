// Decisão do que fazer quando a conexão do WhatsApp cai (função pura, testada).
import { DisconnectReason } from "baileys";

const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;

export type CloseDecision =
  | { kind: "reconnect"; delayMs: number }
  | { kind: "logged-out"; reason: string }
  | { kind: "stop"; status: "ERROR" | "DISCONNECTED"; reason: string };

export const REASONS = {
  loggedOut:
    "A sessão foi encerrada no celular (WhatsApp > Dispositivos conectados). Conecte o número de novo para voltar a postar.",
  replaced: "Este número foi aberto em outro lugar. Clique em Reconectar para voltar a usá-lo aqui.",
  forbidden: "O WhatsApp recusou a conexão deste número (pode ser bloqueio). Confira o número no celular.",
  qrExpired: "O QR Code expirou sem ser lido. Clique em Reconectar para gerar outro.",
  reconnecting: "Conexão caiu. Reconectando...",
  interrupted: "A conexão foi interrompida antes de ler o QR Code. Clique em Reconectar.",
} as const;

/** Espera exponencial (2s, 4s, 8s... até 5 min) com variação de ±20%. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export function decideOnClose(input: {
  statusCode: number | undefined;
  /** true se o número já foi pareado (creds.me existe). */
  paired: boolean;
  attempt: number;
  random?: () => number;
}): CloseDecision {
  const { statusCode, paired, attempt } = input;

  // Depois de ler o QR o WhatsApp derruba a conexão de propósito: reconectar já.
  if (statusCode === DisconnectReason.restartRequired) return { kind: "reconnect", delayMs: 0 };

  if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.multideviceMismatch) {
    return { kind: "logged-out", reason: REASONS.loggedOut };
  }
  // Ainda sem pareamento: o QR expirou. Não fica gerando QR para sempre.
  if (!paired) return { kind: "stop", status: "DISCONNECTED", reason: REASONS.qrExpired };

  if (statusCode === DisconnectReason.connectionReplaced) {
    return { kind: "stop", status: "ERROR", reason: REASONS.replaced };
  }
  if (statusCode === DisconnectReason.forbidden) {
    return { kind: "stop", status: "ERROR", reason: REASONS.forbidden };
  }
  return { kind: "reconnect", delayMs: backoffDelay(attempt, input.random) };
}
