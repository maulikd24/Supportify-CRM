import { prisma } from "@/lib/db/prisma";

/** Generates the next sequential human-readable client code, e.g. "CL-00001". */
export async function generateClientCode(): Promise<string> {
  const last = await prisma.client.findFirst({
    orderBy: { createdAt: "desc" },
    select: { clientCode: true },
  });

  const lastNumber = last ? parseInt(last.clientCode.replace("CL-", ""), 10) || 0 : 0;
  const next = lastNumber + 1;
  return `CL-${String(next).padStart(5, "0")}`;
}
