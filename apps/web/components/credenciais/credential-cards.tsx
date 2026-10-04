"use client";

import type { AffiliateStore } from "@achadinhos/stores";
import { CheckCircle2Icon, CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import {
  readMercadoLivreLinkAction,
  readSheinAction,
  removeCredentialAction,
  saveAmazonAction,
  saveMercadoLivreAction,
  saveSheinAction,
  saveShopeeAction,
  testShopeeAction,
  type CredentialResult,
} from "@/app/painel/credenciais/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CredentialHelp } from "./help";

export interface CredentialStatus {
  configured: boolean;
  synced: boolean;
  lastError: string | null;
  fields: { name: string; masked: string }[];
}

function StatusBadge({ status }: { status: CredentialStatus }) {
  if (status.synced) {
    return (
      <Badge className="gap-1 bg-green-600 text-white">
        <CheckCircle2Icon className="size-3" /> Sincronizado
      </Badge>
    );
  }
  if (status.configured) {
    return (
      <Badge variant="destructive" className="gap-1">
        <TriangleAlertIcon className="size-3" /> Não sincronizado
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <CircleDashedIcon className="size-3" /> Não configurado
    </Badge>
  );
}

function Field(props: { id: string; label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

function useAction() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CredentialResult | null>(null);
  const run = (action: () => Promise<CredentialResult>) => startTransition(async () => setResult(await action()));
  const feedback = result ? (
    <p role="status" className={result.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>
      {result.ok ? result.message : result.error}
    </p>
  ) : null;
  return { pending, run, feedback, setResult };
}

function StoreCard(props: {
  store: AffiliateStore;
  name: string;
  description: string;
  status: CredentialStatus;
  canEdit: boolean;
  children: ReactNode;
}) {
  const remove = useAction();
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{props.name}</CardTitle>
          <StatusBadge status={props.status} />
        </div>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.status.configured ? (
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {props.status.fields.map((f) => (
              <li key={f.name}>
                {f.name}: <span className="font-mono">{f.masked}</span>
              </li>
            ))}
            {props.status.lastError ? <li className="text-destructive">Último teste: {props.status.lastError}</li> : null}
          </ul>
        ) : null}
        {props.canEdit ? props.children : <p className="text-sm text-muted-foreground">Só o dono da conta pode alterar.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CredentialHelp store={props.store} />
          {props.canEdit && props.status.configured ? (
            <Button variant="ghost" size="sm" disabled={remove.pending} onClick={() => remove.run(() => removeCredentialAction(props.store))}>
              Remover
            </Button>
          ) : null}
        </div>
        {remove.feedback}
      </CardContent>
    </Card>
  );
}

export function ShopeeCard({ status, canEdit }: { status: CredentialStatus; canEdit: boolean }) {
  const [appId, setAppId] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const action = useAction();
  return (
    <StoreCard store="SHOPEE" name="Shopee" description="AppID e Senha da API da sua conta de afiliado." status={status} canEdit={canEdit}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() => saveShopeeAction({ appId, apiSecret }));
        }}
      >
        <Field id="shopee-appid" label="AppID" hint="Só números, mínimo de 10 dígitos.">
          <Input id="shopee-appid" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ""))} required minLength={10} />
        </Field>
        <Field id="shopee-secret" label="Senha da API">
          <Input id="shopee-secret" type="password" autoComplete="off" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={action.pending}>
            {action.pending ? "Testando..." : "Salvar e testar"}
          </Button>
          {status.configured ? (
            <Button type="button" variant="outline" disabled={action.pending} onClick={() => action.run(testShopeeAction)}>
              Testar
            </Button>
          ) : null}
        </div>
      </form>
      {action.feedback}
    </StoreCard>
  );
}

export function AmazonCard({ status, canEdit }: { status: CredentialStatus; canEdit: boolean }) {
  const [tag, setTag] = useState("");
  const [creatorsId, setCreatorsId] = useState("");
  const [creatorsSecret, setCreatorsSecret] = useState("");
  const action = useAction();
  return (
    <StoreCard store="AMAZON" name="Amazon" description="Sua tag (ID de rastreamento) do Associados Amazon." status={status} canEdit={canEdit}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() =>
            saveAmazonAction({ tag, creatorsCredentialId: creatorsId, creatorsCredentialSecret: creatorsSecret }),
          );
        }}
      >
        <Field id="amazon-tag" label="Tag / ID de rastreamento" hint="Ex.: minhaloja-20">
          <Input id="amazon-tag" value={tag} onChange={(e) => setTag(e.target.value)} required placeholder="nome-20" />
        </Field>
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          API de Criadores (opcional): a Amazon só libera depois de 10 vendas aprovadas em 30 dias. Sem ela, seus links funcionam
          normalmente só com a tag.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="amazon-cid" label="ID da API de Criadores (opcional)">
            <Input id="amazon-cid" autoComplete="off" value={creatorsId} onChange={(e) => setCreatorsId(e.target.value)} />
          </Field>
          <Field id="amazon-csecret" label="Segredo da API de Criadores (opcional)">
            <Input id="amazon-csecret" type="password" autoComplete="off" value={creatorsSecret} onChange={(e) => setCreatorsSecret(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" className="w-fit" disabled={action.pending}>
          {action.pending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
      {action.feedback}
    </StoreCard>
  );
}

export function MercadoLivreCard({ status, canEdit }: { status: CredentialStatus; canEdit: boolean }) {
  const [link, setLink] = useState("");
  const [mattWord, setMattWord] = useState("");
  const [mattTool, setMattTool] = useState("");
  const action = useAction();
  const [reading, startReading] = useTransition();
  return (
    <StoreCard
      store="MERCADO_LIVRE"
      name="Mercado Livre"
      description="Cole um link de afiliado já gerado: o sistema preenche a Etiqueta e o ID da Ferramenta."
      status={status}
      canEdit={canEdit}
    >
      <div className="grid gap-3">
        <Field id="ml-link" label="Link de afiliado (meli.la ou completo)">
          <div className="flex gap-2">
            <Input id="ml-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meli.la/..." />
            <Button
              type="button"
              variant="outline"
              disabled={reading || link.trim().length < 10}
              onClick={() =>
                startReading(async () => {
                  const r = await readMercadoLivreLinkAction(link);
                  if (r.ok) {
                    setMattWord(r.mattWord);
                    setMattTool(r.mattTool);
                    action.setResult({ ok: true, message: "Link lido. Confira os campos e clique em Salvar." });
                  } else action.setResult({ ok: false, error: r.error });
                })
              }
            >
              {reading ? "Lendo..." : "Ler link"}
            </Button>
          </div>
        </Field>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(() => saveMercadoLivreAction({ mattWord, mattTool }));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ml-word" label="Etiqueta (matt_word)">
              <Input id="ml-word" value={mattWord} onChange={(e) => setMattWord(e.target.value)} required />
            </Field>
            <Field id="ml-tool" label="ID da Ferramenta (matt_tool)">
              <Input id="ml-tool" inputMode="numeric" value={mattTool} onChange={(e) => setMattTool(e.target.value.replace(/\D/g, ""))} required />
            </Field>
          </div>
          <Button type="submit" className="w-fit" disabled={action.pending || !mattWord || !mattTool}>
            {action.pending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </div>
      {action.feedback}
    </StoreCard>
  );
}

export function SheinCard({ status, canEdit }: { status: CredentialStatus; canEdit: boolean }) {
  const [value, setValue] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  const action = useAction();
  const [reading, startReading] = useTransition();
  return (
    <StoreCard
      store="SHEIN"
      name="Shein"
      description="Cole um link de afiliado (onelink.shein.com ou br.shein.com) ou digite o seu ID."
      status={status}
      canEdit={canEdit}
    >
      <div className="grid gap-3">
        <Field id="shein-link" label="Link de afiliado ou ID">
          <div className="flex gap-2">
            <Input id="shein-link" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://onelink.shein.com/... ou 1234567890" />
            <Button
              type="button"
              variant="outline"
              disabled={reading || value.trim().length < 4}
              onClick={() =>
                startReading(async () => {
                  const r = await readSheinAction(value);
                  if (r.ok) {
                    setAffiliateId(r.affiliateId);
                    action.setResult({ ok: true, message: "ID encontrado. Confira e clique em Salvar." });
                  } else action.setResult({ ok: false, error: r.error });
                })
              }
            >
              {reading ? "Lendo..." : "Ler"}
            </Button>
          </div>
        </Field>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(() => saveSheinAction({ affiliateId }));
          }}
        >
          <Field id="shein-id" label="ID de afiliado">
            <Input id="shein-id" inputMode="numeric" value={affiliateId} onChange={(e) => setAffiliateId(e.target.value.replace(/\D/g, ""))} required />
          </Field>
          <Button type="submit" disabled={action.pending || !affiliateId}>
            {action.pending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </div>
      {action.feedback}
    </StoreCard>
  );
}
