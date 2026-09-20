"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ShellUser } from "./shell-types";

export interface UserMenuProps {
  user: ShellUser;
}

/**
 * Account menu in the header: initials avatar + name, role, and sign out.
 * Desktop shows the name inline; compact on small screens.
 */
export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setPending(true);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2.5 rounded-lg border border-border bg-background px-2 py-1.5 transition-colors hover:bg-muted",
          open && "bg-muted",
        )}
      >
        <Avatar name={user.name} className="size-7 text-2xs" />
        <span className="hidden max-w-40 truncate text-sm font-medium text-foreground sm:block">
          {user.name || user.email}
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-3.5 text-muted-foreground", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-background shadow-dialog animate-scale-in"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Avatar name={user.name} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-foreground">{user.name || user.email}</p>
              <p className="truncate text-2xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="px-4 py-2.5">
            <p className="flex items-center gap-2 text-2xs text-muted-foreground">
              <UserRound aria-hidden="true" className="size-3.5" />
              {user.roleLabel}
            </p>
          </div>
          <div className="border-t border-border p-2">
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive-surface disabled:opacity-60"
            >
              <LogOut aria-hidden="true" className="size-4" />
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}