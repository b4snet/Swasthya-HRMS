import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const separatorVariants = cva("shrink-0", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "h-full w-px",
    },
    tone: {
      default: "bg-border",
      strong: "bg-input",
    },
  },
  defaultVariants: { orientation: "horizontal", tone: "default" },
});

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<"div">,
    VariantProps<typeof separatorVariants> {}

export function Separator({ className, orientation, tone, ...props }: SeparatorProps) {
  return <div className={cn(separatorVariants({ orientation, tone }), className)} {...props} />;
}