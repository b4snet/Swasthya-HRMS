"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { navIcon } from "./icons";
import type { ShellNavSection, ShellUser } from "./shell-types";

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface SidebarProps {
  sections: ShellNavSection[];
  user: ShellUser;
  className?: string;
}

/**
 * Primary navigation. Grouped nav with active-state highlighting and a user
 * footer. Rendered identically on desktop (fixed rail) and inside the mobile
 * drawer — the shell decides the wrapper.
 */
export function Sidebar({ sections, user, className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-lg">
          <Home aria-hidden="true" className="size-4 text-primary" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-white">Swasthya HRMS</p>
          <p className="text-2xs text-sidebar-muted">Workforce operations</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-6">
          {sections.map((section) => (
            <li key={section.id}>
              {section.label ? (
                <p className="px-3 pb-1.5 text-2xs font-medium uppercase tracking-widest text-sidebar-muted">
                  {section.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = navIcon(item.icon);
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-muted",
                          active
                            ? "bg-white/10 font-medium text-white"
                            : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 px-3 pb-3 pt-2">
        <Separator tone="strong" className="mx-1 bg-white/10" />
        <div className="mt-3 flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-white">{user.name || user.email}</p>
            <p className="truncate text-2xs text-sidebar-muted">{user.roleLabel}</p>
          </div>
          <Link
            href="/login"
            aria-label="Sign in as a different account"
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}