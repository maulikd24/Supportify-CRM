import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth/require-role";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Supportify · Platform Admin</span>
          <nav className="flex gap-4 text-sm opacity-80">
            <Link href="/admin" className="hover:opacity-100">
              Organizations
            </Link>
          </nav>
          <Link href="/dashboard" className="ml-auto text-sm underline opacity-80 hover:opacity-100">
            Exit to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
