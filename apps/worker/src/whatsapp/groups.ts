// Sincroniza os grupos do número (groupFetchAllParticipating) com a tabela Group.
import type { TenantDb } from "@achadinhos/db";
import { jidNormalizedUser } from "baileys";

/** Subconjunto do GroupMetadata do Baileys que usamos. */
export interface GroupInfo {
  id: string;
  subject: string;
  size?: number | undefined;
  announce?: boolean | undefined;
  isCommunity?: boolean | undefined;
  participants: { id: string; lid?: string | undefined; phoneNumber?: string | undefined; admin?: string | null | undefined }[];
}

export interface GroupRow {
  externalId: string;
  name: string;
  participantsCount: number;
  canSend: boolean;
  isAdmin: boolean;
}

/** JIDs que identificam o próprio número (PN e LID, normalizados). */
export function selfIdsFrom(user: { id: string; lid?: string | undefined } | undefined): Set<string> {
  const ids = new Set<string>();
  if (user?.id) ids.add(jidNormalizedUser(user.id));
  if (user?.lid) ids.add(jidNormalizedUser(user.lid));
  return ids;
}

export function toGroupRows(groups: GroupInfo[], selfIds: Set<string>): GroupRow[] {
  return groups
    .filter((g) => !g.isCommunity) // comunidade "pai" não recebe mensagens
    .map((g) => {
      const me = g.participants.find((p) =>
        [p.id, p.lid, p.phoneNumber].some((id) => id && selfIds.has(jidNormalizedUser(id))),
      );
      const isAdmin = me?.admin === "admin" || me?.admin === "superadmin";
      return {
        externalId: g.id,
        name: g.subject || "Grupo sem nome",
        participantsCount: g.size ?? g.participants.length,
        canSend: !g.announce || isAdmin,
        isAdmin,
      };
    });
}

/** Upsert dos grupos atuais; os que sumiram ficam inativos e deixam de receber posts. */
export async function syncGroups(
  db: TenantDb,
  tenantId: string,
  channelId: string,
  groups: GroupInfo[],
  selfIds: Set<string>,
) {
  const rows = toGroupRows(groups, selfIds);
  for (const row of rows) {
    await db.group.upsert({
      where: { channelId_externalId: { channelId, externalId: row.externalId } },
      create: { tenantId, channelId, ...row },
      update: {
        name: row.name,
        participantsCount: row.participantsCount,
        canSend: row.canSend,
        isAdmin: row.isAdmin,
        active: true,
      },
    });
  }
  const gone = await db.group.updateMany({
    where: { channelId, active: true, externalId: { notIn: rows.map((r) => r.externalId) } },
    data: { active: false, postingEnabled: false },
  });
  return { total: rows.length, removed: gone.count };
}
