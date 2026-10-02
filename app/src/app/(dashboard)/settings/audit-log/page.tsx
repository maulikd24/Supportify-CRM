import { redirect } from "next/navigation";

/** The audit log moved to the product-neutral Organization area. */
export default function AuditLogRedirect() {
  redirect("/org/audit-log");
}
