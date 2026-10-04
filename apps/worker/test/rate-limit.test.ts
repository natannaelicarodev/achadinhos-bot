import { describe, expect, it } from "vitest";
import { checkTestSend, memoryTestSendHistory, PerKeyMutex } from "../src/whatsapp/rate-limit";

const SEC = 1000;
const MIN = 60 * SEC;

describe("limite de envio de teste", () => {
  it("libera o primeiro envio", () => {
    expect(checkTestSend([], 0)).toEqual({ ok: true });
  });

  it("exige 20 segundos entre envios", () => {
    const now = 100 * MIN;
    const result = checkTestSend([now - 5 * SEC], now);
    expect(result).toEqual({ ok: false, message: "Aguarde 15s para enviar outro teste por este número." });
    expect(checkTestSend([now - 20 * SEC], now)).toEqual({ ok: true });
  });

  it("no máximo 10 por hora; libera quando o mais antigo sai da janela", () => {
    const now = 100 * MIN;
    const ten = Array.from({ length: 10 }, (_, i) => now - (i + 1) * 5 * MIN); // 5..50 min atrás
    const blocked = checkTestSend(ten, now);
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.message).toBe(
      "Limite de 10 envios de teste por hora para este número. Tente de novo em 10 min.",
    );
    expect(checkTestSend(ten, now + 10 * MIN + 1)).toEqual({ ok: true });
  });

  it("envios com mais de 1 hora não contam", () => {
    const now = 300 * MIN;
    const old = Array.from({ length: 10 }, (_, i) => now - 61 * MIN - i * MIN);
    expect(checkTestSend(old, now)).toEqual({ ok: true });
  });

  it("histórico guarda só os 10 últimos", async () => {
    const history = memoryTestSendHistory();
    for (let i = 0; i < 15; i++) await history.record("c1", i);
    expect(await history.list("c1")).toHaveLength(10);
    expect(await history.list("c2")).toEqual([]);
  });
});

describe("PerKeyMutex", () => {
  it("executa tarefas da mesma chave uma de cada vez", async () => {
    const mutex = new PerKeyMutex();
    const order: string[] = [];
    const slow = mutex.run("k", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
    });
    const fast = mutex.run("k", async () => {
      order.push("b");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a", "b"]);
  });
});
