import type { ChannelStatus } from "@achadinhos/db";

export const STATUS_LABEL: Record<ChannelStatus, string> = {
  DISCONNECTED: "Desconectado",
  CONNECTING: "Conectando...",
  QR_PENDING: "Aguardando leitura do QR Code",
  CONNECTED: "Conectado",
  LOGGED_OUT: "Sessão encerrada no celular",
  ERROR: "Com problema",
};

/** Status em que o painel consulta o worker com frequência. */
export const TRANSIENT_STATUSES: ChannelStatus[] = ["CONNECTING", "QR_PENDING"];

/** Status que geram aviso no topo do painel. */
export const ALERT_STATUSES: ChannelStatus[] = ["LOGGED_OUT", "ERROR"];

/** Filtros da lista de grupos (vêm da URL). Padrão: só grupos em que o número é admin. */
export interface GroupFilters {
  search: string;
  onlyAdmin: boolean;
}

export function parseGroupFilters(params: { busca?: string | string[]; todos?: string | string[] }): GroupFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return { search: first(params.busca).trim().slice(0, 100), onlyAdmin: first(params.todos) !== "1" };
}

/** Minúsculas e sem acento: "Promoção" e "promocao" são iguais na busca. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function filterGroups<T extends { name: string; isAdmin: boolean }>(groups: T[], filters: GroupFilters): T[] {
  const terms = normalizeForSearch(filters.search).split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    if (filters.onlyAdmin && !group.isAdmin) return false;
    const name = normalizeForSearch(group.name);
    return terms.every((term) => name.includes(term));
  });
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "Número ainda não identificado";
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${phone}`;
}
