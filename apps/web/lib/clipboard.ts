// Navegador: copiar texto e imagem para a área de transferência.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia a imagem do produto. Passa pela rota /api/image-proxy (mesma origem,
 * só servidores de imagem das lojas) e converte para PNG, que é o formato que
 * a área de transferência aceita em todos os navegadores.
 */
export async function copyImage(imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
    if (!response.ok) return false;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}
