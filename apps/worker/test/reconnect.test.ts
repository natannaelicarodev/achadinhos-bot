import { DisconnectReason } from "baileys";
import { describe, expect, it } from "vitest";
import { backoffDelay, decideOnClose, MAX_DELAY_MS, REASONS } from "../src/whatsapp/reconnect";

const decide = (statusCode: number | undefined, paired = true, attempt = 0) =>
  decideOnClose({ statusCode, paired, attempt, random: () => 0.5 });

describe("decisão ao cair a conexão", () => {
  it("515 (restart depois de ler o QR): reconecta na hora, mesmo sem pareamento completo", () => {
    expect(decide(DisconnectReason.restartRequired, false)).toEqual({ kind: "reconnect", delayMs: 0 });
  });

  it("401 (sessão encerrada no celular) e 411: logged-out, sem reconectar", () => {
    expect(decide(DisconnectReason.loggedOut)).toEqual({ kind: "logged-out", reason: REASONS.loggedOut });
    expect(decide(DisconnectReason.multideviceMismatch).kind).toBe("logged-out");
  });

  it("440 (aberto em outro lugar): para com ERROR, não briga", () => {
    expect(decide(DisconnectReason.connectionReplaced)).toEqual({
      kind: "stop",
      status: "ERROR",
      reason: REASONS.replaced,
    });
  });

  it("403 (recusado/bloqueio): para com ERROR", () => {
    expect(decide(DisconnectReason.forbidden)).toMatchObject({ kind: "stop", status: "ERROR" });
  });

  it("sem pareamento e queda (QR expirou): DISCONNECTED, não gera QR para sempre", () => {
    expect(decide(DisconnectReason.timedOut, false)).toEqual({
      kind: "stop",
      status: "DISCONNECTED",
      reason: REASONS.qrExpired,
    });
  });

  it("queda comum (408, 428, 500, 503, sem código): reconecta com backoff", () => {
    for (const code of [408, 428, 500, 503, undefined]) {
      expect(decide(code, true, 2)).toEqual({ kind: "reconnect", delayMs: 8_000 });
    }
  });
});

describe("backoff", () => {
  it("dobra a cada tentativa e para em 5 minutos", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, mid))).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffDelay(30, mid)).toBe(MAX_DELAY_MS);
  });

  it("variação de ±20%", () => {
    expect(backoffDelay(0, () => 0)).toBe(1_600);
    expect(backoffDelay(0, () => 1)).toBe(2_400);
  });
});
