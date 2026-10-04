// Envio de uma oferta (imagem + texto) para um grupo do WhatsApp.
import type { TenantDb } from "@achadinhos/db";
import { loadImageFromUrl, type ImageResult } from "./image";

/** Erro de envio com mensagem em pt-BR para o painel. */
export class SendError extends Error {
  override name = "SendError";
}

/** Parte do socket do Baileys usada no envio (permite socket falso nos testes). */
export interface WhatsAppSender {
  sendMessage(
    jid: string,
    content: { image: Buffer; caption: string } | { text: string },
  ): Promise<{ key: { id?: string | null } } | undefined>;
}

export interface SendDeps {
  db: TenantDb;
  /** Socket aberto do número, ou undefined se não estiver conectado neste worker. */
  getSocket: (channelId: string) => WhatsAppSender | undefined;
  loadImage?: (url: string) => Promise<ImageResult>;
}

export interface SendResult {
  messageId: string;
  imageSent: boolean;
  /** Aviso em pt-BR quando a imagem foi descartada e foi só o texto. */
  warning?: string;
}

/**
 * Envia para o grupo (id da tabela Group). `image`: Buffer, URL https ou null.
 * Imagem inválida não impede o envio: vai só o texto, com aviso.
 */
export async function sendOfferToWhatsApp(
  deps: SendDeps,
  groupId: string,
  image: Buffer | string | null | undefined,
  text: string,
): Promise<SendResult> {
  const group = await deps.db.group.findUnique({ where: { id: groupId }, include: { channel: true } });
  if (!group || group.channel.type !== "WHATSAPP") throw new SendError("Grupo não encontrado.");
  if (!group.active) throw new SendError("O número não participa mais deste grupo.");
  if (!group.canSend) throw new SendError("Neste grupo só administradores podem enviar mensagens.");

  const socket = deps.getSocket(group.channelId);
  if (!socket || group.channel.status !== "CONNECTED") {
    throw new SendError("O número deste grupo não está conectado.");
  }

  let buffer: Buffer | undefined;
  let warning: string | undefined;
  if (Buffer.isBuffer(image)) {
    buffer = image;
  } else if (typeof image === "string" && image.trim() !== "") {
    const loaded = await (deps.loadImage ?? loadImageFromUrl)(image.trim());
    if (loaded.ok) buffer = loaded.buffer;
    else warning = `Imagem não enviada: ${loaded.reason} A mensagem foi só com o texto.`;
  }

  const sent = await socket.sendMessage(
    group.externalId,
    buffer ? { image: buffer, caption: text } : { text },
  );
  const messageId = sent?.key.id;
  if (!messageId) throw new SendError("O WhatsApp não confirmou o envio. Tente de novo.");
  return { messageId, imageSent: buffer !== undefined, ...(warning ? { warning } : {}) };
}
