import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-success-border bg-success-surface text-success",
        warning: "border-warning-border bg-warning-surface text-warning",
        destructive: "border-destructive-border bg-destructive-surface text-destructive",
        info: "border-info-border bg-info-surface text-info",
        outline: "border-border bg-background text-foreground",
        primary: "border-primary bg-primary text-primary-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Map common entity status strings to a semantic badge variant. */
export function statusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  const s = status.toUpperCase();
  if (["ACTIVE", "APPROVED", "PAID", "VERIFIED", "SUCCESS", "CLOSED"].includes(s)) {
    return "success";
  }
  if (
    ["PENDING", "REVIEW", "CALCULATING", "PENDING_VERIFICATION", "INVITED", "DRAFT"].includes(s)
  ) {
    return "warning";
  }
  if (["SUSPENDED", "LOCKED", "REJECTED", "FAILED", "TERMINATED", "DEACTIVATED"].includes(s)) {
    return "destructive";
  }
  if (["ARCHIVED", "EXPIRED", "SUPERSEDED"].includes(s)) {
    return "info";
  }
  return "neutral";
}

export { badgeVariants };