import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { getProductAccess } from "@/lib/billing/access";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [crm, qa] = await Promise.all([
    getProductAccess(session.user.organizationId, "CRM"),
    getProductAccess(session.user.organizationId, "QA_SENTINEL"),
  ]);

  if (crm.allowed) redirect("/dashboard");
  if (qa.allowed) redirect("/qa");
  redirect("/billing");
}
