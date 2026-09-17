"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import * as React from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const variantClasses: Record<ToastVariant, string> = {
  success: "border-success-border bg-success-surface text-success",
  error: "border-destructive-border bg-destructive-surface text-destructive",
  info: "border-info-border bg-info-surface text-info",
};

/**
 * Radix Toast provider. Toasts render in a live region ("polite") so screen
 * readers announce status changes without interrupting.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const toast = React.useCallback<ToastContextValue["toast"]>((input) => {
    const id = nextId.current++;
    setItems((prev) => [
      ...prev,
      { id, title: input.title, description: input.description, variant: input.variant ?? "info" },
    ]);
  }, []);

  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            duration={6000}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className={cn(
              "rounded-lg border p-4 shadow-md data-[swipe=end]:opacity-0",
              variantClasses[item.variant],
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="mt-1 text-2xs text-foreground">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss notification"
                className="rounded p-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                ×
              </ToastPrimitive.Close>
            </div>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
