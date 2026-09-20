"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command, Search, UserRound, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { searchEmployeesAction, type EmployeeSearchHit } from "@/modules/workforce/api/queries";
import { navIcon } from "./icons";
import type { ShellNavSection } from "./shell-types";

interface PaletteResult {
  key: string;
  label: string;
  sublabel: string;
  href: string;
  kind: "nav" | "employee";
  name?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: ShellNavSection[];
}

/**
 * Global command palette (Cmd/Ctrl+K). Navigation items always resolve
 * locally; employee results come from the server-scoped search action.
 */
export function CommandPalette({ open, onOpenChange, sections }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EmployeeSearchHit[]>([]);
  const [loadingHits, setLoadingHits] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const navResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteResult[] = [];
    for (const section of sections) {
      for (const item of section.items) {
        if (!q || item.label.toLowerCase().includes(q)) {
          out.push({
            key: `nav-${item.href}`,
            label: item.label,
            sublabel: section.label ?? "Navigation",
            href: item.href,
            kind: "nav",
            name: item.icon,
          });
        }
      }
    }
    return out;
  }, [sections, query]);

  const employeeResults: PaletteResult[] = hits.map((hit) => ({
    key: `emp-${hit.id}`,
    label: hit.name,
    sublabel: `${hit.employeeNo} · ${hit.organizationName}`,
    href: hit.href,
    kind: "employee",
    name: hit.name,
  }));

  const results = useMemo(
    () => (query.trim() ? navResults.concat(employeeResults) : navResults),
    [query, navResults, employeeResults],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setLoadingHits(true);
    const t = setTimeout(async () => {
      const res = await searchEmployeesAction(q);
      setHits(res.ok && res.data ? res.data : []);
      setLoadingHits(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    setActive(0);
  }, [results.length]);

  const navigate = useCallback(
    (result: PaletteResult | undefined) => {
      if (!result) return;
      onOpenChange(false);
      router.push(result.href);
    },
    [onOpenChange, router],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((v) => Math.min(v + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((v) => Math.max(v - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        navigate(results[active]);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, results, active, navigate, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px] animate-fade-in"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-dialog animate-scale-in">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees, pages…"
            aria-label="Search"
            className="w-full bg-transparent py-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground sm:flex">
            <Command aria-hidden="true" className="size-3" /> K
          </kbd>
          <button
            type="button"
            aria-label="Close search"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <ul ref={listRef} role="listbox" aria-label="Search results" className="max-h-[42vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-4 py-8 text-center text-2xs text-muted-foreground">
              {query.trim().length > 0 && query.trim().length < 2
                ? "Keep typing to search employees."
                : loadingHits
                  ? "Searching…"
                  : "No matches found."}
            </li>
          ) : (
            results.map((result, index) => {
              const selected = index === active;
              const Icon = result.kind === "nav" ? navIcon(result.name ?? "") : UserRound;
              return (
                <li key={result.key} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => navigate(result)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      selected && "bg-primary/5",
                    )}
                  >
                    {result.kind === "employee" ? (
                      <Avatar name={result.name} className="size-7 text-2xs" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md",
                          selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {result.label}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {result.sublabel}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}