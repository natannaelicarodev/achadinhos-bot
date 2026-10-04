import type { Store } from "@achadinhos/db";

// Campos de credencial por loja. Provisório: cada integração (fase 4+) ajusta os seus.
export const STORES: Record<Store, { label: string; fields: { name: string; label: string }[] }> = {
  AMAZON: {
    label: "Amazon",
    fields: [
      { name: "associateTag", label: "Tag de associado" },
      { name: "accessKey", label: "Access key" },
      { name: "secretKey", label: "Secret key" },
    ],
  },
  MERCADO_LIVRE: {
    label: "Mercado Livre",
    fields: [
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret" },
    ],
  },
  SHOPEE: {
    label: "Shopee",
    fields: [
      { name: "appId", label: "App ID" },
      { name: "secret", label: "Secret" },
    ],
  },
  MAGALU: {
    label: "Magalu",
    fields: [{ name: "partnerId", label: "ID de parceiro" }],
  },
  ALIEXPRESS: {
    label: "AliExpress",
    fields: [
      { name: "appKey", label: "App key" },
      { name: "appSecret", label: "App secret" },
      { name: "trackingId", label: "Tracking ID" },
    ],
  },
  OTHER: {
    label: "Outra loja",
    fields: [{ name: "token", label: "Token" }],
  },
};

export const STORE_CODES = Object.keys(STORES) as Store[];
