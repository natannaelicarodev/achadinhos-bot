import { getStoreCredentialSecrets } from "@achadinhos/db";
import { EXTENSION_VERSION } from "@achadinhos/extension/protocol";
import { amazonSecretsSchema, mercadoLivreSecretsSchema } from "@achadinhos/stores";
import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import { ExtensionDiagnostic, ExtensionStatusBadge } from "@/components/extensao/extension-status";
import { VitrineAdmin } from "@/components/extensao/vitrine-admin";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/current";
import { isSystemAdmin } from "@/lib/ml-vitrine";

export const metadata: Metadata = { title: "Extensão — Achadinhos Bot" };

export default async function ExtensaoPage() {
  const { user } = await requireSession();
  const [mlSecrets, amazonSecrets] = await Promise.all([
    getStoreCredentialSecrets(user.tenantId, "MERCADO_LIVRE"),
    getStoreCredentialSecrets(user.tenantId, "AMAZON"),
  ]);
  const ml = mercadoLivreSecretsSchema.safeParse(mlSecrets);
  const amazon = amazonSecretsSchema.safeParse(amazonSecrets);

  return (
    <>
      <PageHeader
        title="Extensão do Chrome"
        description="Com a extensão, os links curtos do Mercado Livre (meli.la) e da Amazon e o preço real do produto são gerados automaticamente, usando a sua sessão das lojas no navegador."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Instalar</CardTitle>
              <ExtensionStatusBadge />
            </div>
            <CardDescription>Versão atual: {EXTENSION_VERSION}. Funciona no Google Chrome (computador).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <Button render={<a href="/downloads/achadinhos-extensao.zip" download />} nativeButton={false} className="w-fit">
              <DownloadIcon /> Baixar extensão (.zip)
            </Button>
            <ol className="grid list-decimal gap-2 pl-5">
              <li>
                Abra o arquivo baixado: clique com o botão direito em <strong>achadinhos-extensao.zip</strong> e escolha{" "}
                <strong>Extrair tudo</strong>. Guarde a pasta num lugar fixo (ex.: Documentos) e <strong>não apague</strong>.
              </li>
              <li>
                No Chrome, digite <code>chrome://extensions</code> na barra de endereço e aperte Enter.
              </li>
              <li>
                Ligue o <strong>Modo do desenvolvedor</strong> (ou <strong>Modo de programador</strong>), no canto superior
                direito.
              </li>
              <li>
                Clique em <strong>Carregar sem compactação</strong> (ou <strong>Carregar expandida</strong>) e escolha a pasta{" "}
                <strong>achadinhos-extensao</strong>: a que tem os arquivos manifest.json, background.js e content.js.
              </li>
              <li>Volte para esta página e atualize (F5): o status deve mostrar &quot;Instalada&quot;.</li>
            </ol>
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <strong>Para atualizar:</strong> baixe o .zip de novo, substitua os arquivos da pasta e, em{" "}
              <code>chrome://extensions</code>, clique no botão de recarregar (↻) da extensão Achadinhos Bot. O Chrome pode
              mostrar de vez em quando um aviso sobre extensões no modo do desenvolvedor: é normal para extensões instaladas
              por fora da Chrome Web Store.
            </p>
            <p className="text-xs text-muted-foreground">
              A extensão só acessa o Mercado Livre, a Amazon e este painel. Sua senha e sua sessão das lojas nunca saem do
              seu navegador: o painel recebe apenas o link, o título, o preço e a imagem do produto.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Testar</CardTitle>
            <CardDescription>
              Com a extensão instalada e você logada na loja neste Chrome, faça um teste com um produto.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <ExtensionDiagnostic store="ml" tag={ml.success ? ml.data.mattWord : null} />
            <ExtensionDiagnostic store="amz" tag={amazon.success ? amazon.data.tag : null} />
          </CardContent>
        </Card>
        {isSystemAdmin(user.email) ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Vitrine do Mercado Livre e da Amazon no catálogo (administrador)</CardTitle>
              <CardDescription>
                Com a vitrine ativada, a extensão DESTE Chrome busca de hora em hora (enquanto o Chrome estiver aberto) os
                mais vendidos do portal de afiliados do Mercado Livre (precisa estar logada no ML) e os &quot;Mais vendidos&quot;
                da Amazon, e coloca no catálogo de todos os clientes. Só os dados dos produtos são enviados; os links
                continuam sendo de cada cliente. Produto que não volta na vitrine em 48 horas sai do catálogo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VitrineAdmin />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
