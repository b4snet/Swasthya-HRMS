/**
 * Client-side icon lookup for the serializable nav model. Icon choices live
 * in one place so server payloads stay plain JSON.
 */
import {
  Activity,
  Building2,
  ClipboardList,
  LayoutDashboard,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  organization: Building2,
  employees: Users,
  expiry: ClipboardList,
  audit: ShieldCheck,
  system: Activity,
};

export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? LayoutDashboard;
}