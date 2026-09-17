import { AlertTriangle, Loader2, ShieldX } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The five canonical UI states (charter requirement 19).
 * Every feature surface composes these instead of improvising.
 */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 aria-hidden="true" className={cn("h-5 w-5 animate-spin text-primary", className)} />
  );
}

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-10 text-muted-foreground",
        className,
      )}
    >
      <Spinner />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="mb-1 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="max-w-prose text-2xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-destructive-border bg-destructive-surface p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle aria-hidden="true" className="h-5 w-5 text-destructive" />
        <p className="text-sm font-semibold text-destructive">{title}</p>
      </div>
      {message ? (
        <p className="text-2xs text-foreground">{message}</p>
      ) : (
        <p className="text-2xs text-foreground">
          The request could not be completed. No changes were made.
        </p>
      )}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PermissionDeniedState({
  title = "You don't have access to this page",
  message = "If you believe you should have access, contact your HR administrator.",
  className,
}: {
  title?: string;
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-warning-border bg-warning-surface p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldX aria-hidden="true" className="h-5 w-5 text-warning" />
        <p className="text-sm font-semibold text-warning">{title}</p>
      </div>
      <p className="text-2xs text-foreground">{message}</p>
    </div>
  );
}

export function SuccessBanner({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-success-border bg-success-surface p-3 text-sm text-success",
        className,
      )}
    >
      {children}
    </div>
  );
}
