"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Employees section nav (mirrors organization/section-nav.tsx). Items link
 * into the ACTIVE employee's detail area; the directory entry covers the
 * list-level routes.
 */
export const EMPLOYEE_NAV = [
  {
    href: "/employees",
    label: "Directory",
    match: (p: string) => p === "/employees" || p === "/employees/new",
  },
  {
    href: "/employees/[id]/employment",
    label: "Employment",
    match: (p: string) => p.includes("/employment"),
  },
  {
    href: "/employees/[id]/assignments",
    label: "Assignments",
    match: (p: string) => p.includes("/assignments"),
  },
  {
    href: "/employees/[id]/contacts",
    label: "Contacts",
    match: (p: string) => p.includes("/contacts"),
  },
  {
    href: "/employees/[id]/dependents",
    label: "Dependents",
    match: (p: string) => p.includes("/dependents"),
  },
  {
    href: "/employees/[id]/contracts",
    label: "Contracts",
    match: (p: string) => p.includes("/contracts"),
  },
  {
    href: "/employees/[id]/documents",
    label: "Documents",
    match: (p: string) => p.includes("/documents"),
  },
  {
    href: "/employees/[id]/credentials",
    label: "Credentials",
    match: (p: string) => p.includes("/credentials"),
  },
] as const;

export function EmployeeSectionNav({ employeeId }: { employeeId?: string }) {
  const pathname = usePathname();
  const items: Array<{ href: string; label: string; current: boolean }> = EMPLOYEE_NAV.flatMap(
    (item) => {
      const href = employeeId ? item.href.replace("[id]", employeeId) : null;
      if (!href) return [];
      return [{ href, label: item.label as string, current: item.match(pathname) }];
    },
  );

  if (items.length === 0) return null;

  return (
    <nav aria-label="Employee sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 rounded-lg border border-border bg-muted p-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "block whitespace-nowrap rounded-md px-3 py-1.5 text-2xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                item.current
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
