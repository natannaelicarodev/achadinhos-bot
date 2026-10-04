import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupFilters } from "@/components/canais/group-filters";
import { PostingSwitch, SendTestForm, SyncGroupsButton } from "@/components/canais/group-controls";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { getTenantDb } from "@/lib/auth/current";
import { filterGroups, formatPhone, parseGroupFilters, STATUS_LABEL } from "@/lib/whatsapp";

export default async function WhatsappGroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ busca?: string | string[]; todos?: string | string[] }>;
}) {
  const { channelId } = await params;
  const filters = parseGroupFilters(await searchParams);
  const { db } = await getTenantDb();
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "WHATSAPP") notFound();

  const allGroups = await db.group.findMany({
    where: { channelId: channel.id },
    orderBy: [{ active: "desc" }, { postingEnabled: "desc" }, { name: "asc" }],
  });
  const groups = filterGroups(allGroups, filters);
  const enabledCount = allGroups.filter((g) => g.postingEnabled).length;
  const hiddenEnabled = allGroups.filter((g) => g.postingEnabled && !groups.includes(g)).length;
  const connected = channel.status === "CONNECTED";
  const showAllHref = `?${new URLSearchParams({ todos: "1", ...(filters.search ? { busca: filters.search } : {}) })}`;

  return (
    <>
      <Link
        href="/painel/canais"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Canais
      </Link>
      <PageHeader
        title={`Grupos de ${formatPhone(channel.externalId)}`}
        description={`${STATUS_LABEL[channel.status]} · ${enabledCount} grupo(s) marcados para receber posts.`}
      />

      <div className="mb-6">
        {connected ? (
          <SyncGroupsButton channelId={channel.id} />
        ) : (
          <p className="text-sm text-muted-foreground">Conecte o número para atualizar os grupos e enviar testes.</p>
        )}
      </div>

      {allGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum grupo encontrado. O número precisa participar de pelo menos um grupo. Depois clique em Atualizar grupos.
        </div>
      ) : (
        <div className="grid gap-4">
          <GroupFilters initial={filters} />
          <p className="text-sm text-muted-foreground">
            Mostrando {groups.length} de {allGroups.length} grupo(s).
            {hiddenEnabled > 0 ? (
              <>
                {" "}
                {hiddenEnabled} grupo(s) marcados para postar estão fora deste filtro.{" "}
                <Link href={showAllHref} className="underline underline-offset-4">
                  Mostrar todos
                </Link>
              </>
            ) : null}
          </p>

          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {filters.onlyAdmin
                ? "Nenhum grupo em que o número é admin"
                : "Nenhum grupo"}
              {filters.search ? ` com “${filters.search}” no nome` : ""}.{" "}
              {filters.onlyAdmin ? (
                <Link href={showAllHref} className="underline underline-offset-4">
                  Mostrar todos os grupos
                </Link>
              ) : null}
            </div>
          ) : (
            <ul className="grid gap-3">
              {groups.map((group) => (
                <li key={group.id} className="grid gap-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{group.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {group.participantsCount !== null ? <span>{group.participantsCount} participantes</span> : null}
                        {group.isAdmin ? <Badge variant="outline">Admin</Badge> : null}
                        {!group.active ? <Badge variant="secondary">Número saiu do grupo</Badge> : null}
                        {group.active && !group.canSend ? <Badge variant="secondary">Só admins enviam</Badge> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">Postar neste grupo</span>
                      <PostingSwitch
                        groupId={group.id}
                        enabled={group.postingEnabled}
                        disabled={!group.active || !group.canSend}
                        label={`Postar no grupo ${group.name}`}
                      />
                    </div>
                  </div>
                  {connected && group.active && group.canSend ? (
                    <SendTestForm groupId={group.id} groupName={group.name} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
