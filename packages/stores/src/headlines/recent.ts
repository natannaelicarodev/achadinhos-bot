// Últimas headlines de cada grupo (para não repetir nas 10 últimas mensagens).
import { forTenant, type PostStatus, type PrismaClient } from "@achadinhos/db";
import { HEADLINE_NO_REPEAT } from "./provider";

/** Posts que contam como "mensagem do grupo": enviados ou ainda a caminho. */
const COUNTED: PostStatus[] = ["SCHEDULED", "QUEUED", "SENDING", "SENT", "AWAITING_LINK"];

/** Para cada grupo, as últimas headlines (da mais nova para a mais antiga). */
export async function recentGroupHeadlines(
  tenantId: string,
  groupIds: string[],
  options: { client?: PrismaClient; limit?: number } = {},
): Promise<string[][]> {
  const db = forTenant(tenantId, options.client);
  return Promise.all(
    groupIds.map(async (groupId) => {
      const posts = await db.post.findMany({
        where: { groupId, headline: { not: null }, status: { in: COUNTED } },
        orderBy: { createdAt: "desc" },
        take: options.limit ?? HEADLINE_NO_REPEAT,
        select: { headline: true },
      });
      return posts.map((p) => p.headline).filter((h): h is string => Boolean(h));
    }),
  );
}
