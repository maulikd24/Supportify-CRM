"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { markConversationReadAction } from "./actions";

const REFRESH_MS = 15_000;

/**
 * Keeps the Inbox current without a socket: re-renders the page every 15 seconds while it is
 * visible (new inbound messages appear within that time), and marks the open conversation read.
 */
export function InboxLive({ openClientId, hasUnread }: { openClientId: string | null; hasUnread: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    if (!openClientId || !hasUnread) return;
    void markConversationReadAction(openClientId).then(() => router.refresh());
  }, [openClientId, hasUnread, router]);

  return null;
}
