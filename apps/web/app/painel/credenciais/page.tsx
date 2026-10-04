import { listStoreCredentials, type Store } from "@achadinhos/db";
import type { Metadata } from "next";
import {
  AmazonCard,
  MercadoLivreCard,
  SheinCard,
  ShopeeCard,
  type CredentialStatus,
} from "@/components/credenciais/credential-cards";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Configurar credenciais — Achadinhos Bot" };

// Nomes amigáveis para os campos mascarados (os valores nunca vão para a tela).
const FIELD_LABELS: Record<string, string> = {
  appId: "AppID",
  apiSecret: "Senha da API",
  tag: "Tag",
  creatorsCredentialId: "ID da API de Criadores",
  creatorsCredentialSecret: "Segredo da API de Criadores",
  mattWord: "Etiqueta",
  mattTool: "ID da Ferramenta",
  affiliateId: "ID de afiliado",
};

export default async function CredenciaisPage() {
  const { user } = await requireSession();
  const rows = await listStoreCredentials(user.tenantId);
  const statusOf = (store: Store): CredentialStatus => {
    const row = rows.find((r) => r.store === store);
    return {
      configured: Boolean(row),
      synced: Boolean(row?.verifiedAt),
      lastError: row?.lastError ?? null,
      fields: (row?.fields ?? []).map((f) => ({ name: FIELD_LABELS[f.name] ?? f.name, masked: f.masked })),
    };
  };
  const canEdit = user.role === "OWNER";

  return (
    <>
      <PageHeader
        title="Configurar credenciais"
        description="Suas credenciais de afiliado em cada loja. É com elas que os links que você divulga rendem comissão para você. Tudo fica guardado criptografado."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ShopeeCard status={statusOf("SHOPEE")} canEdit={canEdit} />
        <MercadoLivreCard status={statusOf("MERCADO_LIVRE")} canEdit={canEdit} />
        <AmazonCard status={statusOf("AMAZON")} canEdit={canEdit} />
        <SheinCard status={statusOf("SHEIN")} canEdit={canEdit} />
        <Card className="opacity-70">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Magalu</CardTitle>
              <Badge variant="secondary">Em breve</Badge>
            </div>
            <CardDescription>A integração com o Parceiro Magalu chega numa próxima atualização.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
