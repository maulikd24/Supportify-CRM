"use client";

import { useEffect, useRef } from "react";

import type { Role } from "@/generated/prisma/client";
import { describeNotification } from "@/components/notifications-bell";
import { getNewSlaBreachNotificationsAction } from "@/app/(dashboard)/notifications-actions";

const POLL_INTERVAL_MS = 45_000;
const NOTIFIED_IDS_KEY = "sla-notified-ids";

function loadNotifiedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_IDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveNotifiedIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(NOTIFIED_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable — dedupe just degrades to in-memory only for this poll cycle.
  }
}

/** Pops a browser-level Notification for RMs/Managers when a new SLA breach is detected while they're logged in. Renders nothing. */
export function SlaNotificationPoller({ role }: { role: Role }) {
  const lastCheckedRef = useRef<string>(new Date().toISOString());
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const promptedRef = useRef(false);

  useEffect(() => {
    if (role !== "RM" && role !== "MANAGER") return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    notifiedIdsRef.current = loadNotifiedIds();

    async function poll() {
      const since = lastCheckedRef.current;
      lastCheckedRef.current = new Date().toISOString();

      let breaches;
      try {
        breaches = await getNewSlaBreachNotificationsAction(since);
      } catch {
        return; // e.g. session no longer valid — stay quiet, don't spam the console
      }

      const unseen = breaches.filter((n) => !notifiedIdsRef.current.has(n.id));
      if (unseen.length === 0) return;

      if (Notification.permission === "default" && !promptedRef.current) {
        promptedRef.current = true;
        await Notification.requestPermission();
      }

      if (Notification.permission !== "granted") {
        for (const n of unseen) notifiedIdsRef.current.add(n.id);
        saveNotifiedIds(notifiedIdsRef.current);
        return;
      }

      for (const n of unseen) {
        const payload = n.payload as Record<string, unknown>;
        const popup = new Notification("SLA breach", {
          body: describeNotification(n),
          tag: n.id,
        });
        popup.onclick = () => {
          window.focus();
          if (typeof payload.clientId === "string") {
            window.location.href = `/clients/${payload.clientId}`;
          }
          popup.close();
        };
        notifiedIdsRef.current.add(n.id);
      }
      saveNotifiedIds(notifiedIdsRef.current);
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [role]);

  return null;
}
