import { redirect } from "next/navigation";

import { CompleteSsoLogin } from "./complete-sso-login";

export default async function SsoCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/login");

  return <CompleteSsoLogin token={token} />;
}
