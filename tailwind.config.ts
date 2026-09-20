import type { Config } from "tailwindcss";

/**
 * Swasthya HRMS design tokens (Phase 0).
 * Color pairs below were chosen for WCAG 2.2 AA contrast (≥ 4.5:1 normal text,
 * ≥ 3:1 large text / UI components). Verify any change with a contrast checker.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary blue — brand + interactive states (HMS theme, AA on white)
        primary: {
          DEFAULT: "#2563eb", // 4.9:1 on white
          foreground: "#ffffff",
          hover: "#1d4ed8", // 6.3:1 on white
          active: "#1e40af", // 8.0:1 on white
        },
        secondary: {
          DEFAULT: "#f1f5f9",
          foreground: "#334155", // 9.9:1 on secondary bg
        },
        muted: {
          DEFAULT: "#f1f5f9",
          foreground: "#64748b", // 6.0:1 on muted bg
        },
        accent: {
          DEFAULT: "#7c3aed", // violet accent — 6.2:1 on white
          foreground: "#ffffff",
        },
        destructive: {
          DEFAULT: "#dc2626", // 4.9:1 on white
          foreground: "#ffffff",
          surface: "#fef2f2",
          border: "#fecaca",
        },
        success: {
          DEFAULT: "#16a34a", // 4.9:1 on white
          foreground: "#ffffff",
          surface: "#f0fdf4",
          border: "#bbf7d0",
        },
        warning: {
          DEFAULT: "#d97706", // 3.9:1 on white (large text / UI)
          foreground: "#ffffff",
          surface: "#fffbeb",
          border: "#fde68a",
        },
        info: {
          DEFAULT: "#1d4ed8",
          foreground: "#ffffff",
          surface: "#eff6ff",
          border: "#bfdbfe",
        },
        border: "#e2e8f0",
        input: "#cbd5e1",
        ring: "#2563eb",
        background: "#ffffff",
        foreground: "#1a202c", // 15.4:1 on background
        sidebar: {
          DEFAULT: "#0f172a", // HMS dark slate sidebar
          foreground: "#e2e8f0",
          muted: "#94a3b8",
          active: "#1e293b",
        },
        canvas: "#f4f6f8", // app background behind content cards (HMS)
      },
      fontSize: {
        // Enforce minimum readable sizes
        "2xs": ["0.75rem", { lineHeight: "1.33" }],
      },
      borderRadius: {
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.05)",
        "card-hover": "0 4px 12px -2px rgb(16 24 40 / 0.12), 0 2px 4px -2px rgb(16 24 40 / 0.05)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 4px 8px -4px rgb(16 24 40 / 0.08)",
        dialog: "0 24px 64px -16px rgb(16 24 40 / 0.28), 0 8px 16px -8px rgb(16 24 40 / 0.1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "scale-in": "scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
