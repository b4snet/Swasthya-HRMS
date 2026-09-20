import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "outline";

const toneClasses: Record<StatTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  destructive: "bg-destructive-surface text-destructive",
  info: "bg-info-surface text-info",
  outline: "border border-border text-foreground",
};

/**
 * KPI stat card used across dashboard surfaces. Value never relies on color
 * alone — label + value are always present.
 */
export interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: StatTone;
  helper?: string;
  href?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  helper,
  href,
}: StatCardProps) {
  const content = (
    <Card className="h-full transition-shadow hover:shadow-card-hover">
      <CardContent className="flex items-start gap-4 p-5">
        <span
          aria-hidden="true"
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}
        >
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold leading-none tracking-tight text-foreground">
            {value}
          </p>
          {helper ? <p className="mt-2 text-2xs text-muted-foreground">{helper}</p> : null}
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block focus-visible:rounded-xl">
        {content}
      </Link>
    );
  }
  return content;
}