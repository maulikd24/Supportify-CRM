import { redirect } from "next/navigation";

/** Account settings moved to the product-neutral Organization area. */
export default function AccountSettingsRedirect() {
  redirect("/org/account");
}
