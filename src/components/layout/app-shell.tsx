"use client";

import { useEffect, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { AlertsDropdown } from "./alerts-dropdown";
import { NotificationsDropdown } from "@/modules/notifications/components/notifications-dropdown";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";
import type { ShellAlertItem, ShellNavSection, ShellUser } from "./shell-types";

export interface AppShellProps {
  children: React.ReactNode;
  sections: ShellNavSection[];
  alerts: ShellAlertItem[];
  user: ShellUser;
}

/**
 * Application frame: deep-teal sidebar rail (desktop) + drawer (mobile),
 * sticky top bar with quick search, expiry alerts and the account menu.
 * Children render inside the scrollable content column.
 */
export function AppShell({ children, sections, alerts, user }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen || paletteOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen, paletteOpen]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-md"
      >
        Skip to main content
      </a>

      <div className="flex min-h-screen">
        <aside
          aria-label="Primary"
          className="hidden h-screen w-60 shrink-0 border-r border-sidebar-active bg-sidebar lg:sticky lg:top-0 lg:block"
        >
          <Sidebar sections={sections} user={user} />
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-[80] lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-fade-in"
            />
            <div className="absolute inset-y-0 left-0 w-60 max-w-[85vw] bg-sidebar shadow-dialog animate-slide-in-right">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-sidebar-muted hover:bg-white/10 hover:text-white"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
              <Sidebar sections={sections} user={user} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-border p-2 text-foreground hover:bg-muted lg:hidden"
              >
                <Menu aria-hidden="true" className="size-4" />
              </button>
              <p className="text-sm font-semibold tracking-tight text-foreground lg:hidden">
                Swasthya HRMS
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Search aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-2xs sm:flex">
                &#8984;K
              </kbd>
            </button>

            <div className="flex items-center gap-2.5">
              <AlertsDropdown alerts={alerts} />
              <NotificationsDropdown />
              <UserMenu user={user} />
            </div>
          </header>

          <main id="main-content" className="flex-1 px-4 py-6 lg:px-6">
            {children}
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={sections}
      />
    </>
  );
}