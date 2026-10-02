import { redirect } from "next/navigation";

/** SSO settings moved to the product-neutral Organization area. */
export default function SsoSettingsRedirect() {
  redirect("/org/sso");
}
