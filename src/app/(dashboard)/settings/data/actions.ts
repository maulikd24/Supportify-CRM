"use server";

import { signOut } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";

/** Only the org OWNER can delete the organization — this is irreversible and takes every product/user/client with it. */
export async function deleteOrganizationAction(confirmName: string) {
  const session = await requireOrg(["OWNER"]);

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { name: true },
  });
  if (confirmName.trim() !== organization.name) {
    throw new Error("Organization name doesn't match — deletion cancelled.");
  }

  // Cascades to every tenant-scoped table via onDelete: Cascade in schema.prisma.
  await prisma.organization.delete({ where: { id: session.user.organizationId } });

  await signOut({ redirectTo: "/login" });
}
