"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const SECTION_NAV = [
  { href: "/organization", label: "Overview" },
  { href: "/organization/structure", label: "Structure" },
  { href: "/organization/departments", label: "Departments" },
  { href: "/organization/teams", label: "Teams" },
  { href: "/organization/positions", label: "Positions" },
  { href: "/organization/designations", label: "Designations" },
  { href: "/organization/job-families", label: "Job families" },
  { href: "/organization/grades", label: "Grades" },
  { href: "/organization/locations", label: "Locations" },
  { href: "/organization/facilities", label: "Facilities" },
] as const;

/**
 * Client island for the section nav: `aria-current` needs the live pathname,
 * which only client components can read (usePathname).
 */
export function SectionNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Organization sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 rounded-lg border border-border bg-muted p-1">
        {SECTION_NAV.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-md px-3 py-1.5 text-2xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  current
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
