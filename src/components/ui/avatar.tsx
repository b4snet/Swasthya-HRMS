import { cn } from "@/lib/utils";

/**
 * Initials avatar. Deterministic subtle tone per name; falls back to a simple
 * glyph when no name is available. Surfaces rely on color + initials together
 * (color is never the only signal).
 */
export function initialsOf(first?: string | null, last?: string | null): string {
  const f = first?.trim()?.charAt(0) ?? "";
  const l = last?.trim()?.charAt(0) ?? "";
  return (f + l).toUpperCase() || "?";
}

const toneBackgrounds = [
  "bg-primary/10 text-primary",
  "bg-accent/10 text-accent",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-info/10 text-info",
  "bg-destructive/10 text-destructive",
];

function hashTone(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface AvatarProps {
  name?: string | null;
  initials?: string;
  className?: string;
}

export function Avatar({ name, initials, className }: AvatarProps) {
  const glyph = initials ?? (name ? initialsOf(name.split(" ")[0], name.split(" ").slice(1).pop()) : "?");
  const tone = name ? toneBackgrounds[hashTone(name) % toneBackgrounds.length] : toneBackgrounds[0];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tracking-wide",
        tone,
        className,
      )}
    >
      {glyph}
    </span>
  );
}