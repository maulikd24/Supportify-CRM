"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

/**
 * Header search box. A plain GET form to a list page that already filters by
 * `q`, so it works without JS; ⌘K / Ctrl+K focuses it.
 */
export function HeaderSearch({ action, placeholder }: { action: string; placeholder: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action={action} role="search" className="hidden xl:block">
      <label className="flex h-9 w-52 items-center gap-2 rounded-md border border-border bg-card px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          name="q"
          type="search"
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        <kbd className="text-[10px] font-medium text-muted-foreground">⌘K</kbd>
      </label>
    </form>
  );
}
