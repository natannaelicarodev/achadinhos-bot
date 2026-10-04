import { parseWhatsappFormatting } from "@achadinhos/stores/message";

/** Prévia no estilo do WhatsApp (balão verde, *negrito*, _itálico_, ~riscado~). */
export function WhatsappPreview({ text, imageUrl }: { text: string; imageUrl?: string | null }) {
  return (
    <div className="rounded-xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">
      <div className="ml-auto max-w-[85%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] text-[13px] leading-snug text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="max-h-56 w-full bg-white object-contain" />
        ) : null}
        <div className="px-2.5 py-1.5 break-words whitespace-pre-wrap">
          {text.split("\n").map((line, i) => (
            <span key={i} className="block min-h-[1em]">
              {parseWhatsappFormatting(line).map((seg, j) => (
                <span
                  key={j}
                  className={[seg.bold && "font-bold", seg.italic && "italic", seg.strike && "line-through"]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {seg.text}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
