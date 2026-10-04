import { prisma } from "@/lib/db/prisma";

/**
 * Generates the org's next sequential client code, e.g. "CL-00001". Numbering is per
 * organization: the increment is a single atomic UPDATE on that org's counter, so
 * concurrent creates never collide, and one tenant's codes reveal nothing about others.
 */
export async function generateClientCode(organizationId: string): Promise<string> {
  const { clientCodeSeq } = await prisma.organization.update({
    where: { id: organizationId },
    data: { clientCodeSeq: { increment: 1 } },
    select: { clientCodeSeq: true },
  });
  return `CL-${String(clientCodeSeq).padStart(5, "0")}`;
}
