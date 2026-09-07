import Link from "next/link";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { VerifyEmailBanner } from "@/components/verify-email-banner";

const NAV_ITEMS = [
  { href: "/qa", label: "Overview" },
  { href: "/qa/reviews", label: "Reviews" },
  { href: "/qa/agents", label: "Agents" },
  { href: "/qa/dsat", label: "DSAT" },
  { href: "/qa/settings", label: "Settings" },
  { href: "/billing/QA_SENTINEL", label: "Billing" },
] as const;

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("QA_SENTINEL");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });

  return (
    <div className="min-h-screen">
      {!user.emailVerifiedAt && <VerifyEmailBanner />}
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Supportify QA</span>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
