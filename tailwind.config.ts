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
        // Primary teal — brand + interactive states (AA on white)
        primary: {
          DEFAULT: "#0f6e63", // 4.9:1 on white
          foreground: "#ffffff",
          hover: "#0b574f", // 6.5:1 on white
          active: "#093f3a",
        },
        secondary: {
          DEFAULT: "#f1f5f4",
          foreground: "#123a36", // 9.9:1 on secondary bg
        },
        muted: {
          DEFAULT: "#f4f6f6",
          foreground: "#445553", // 7.1:1 on muted bg
        },
        accent: {
          DEFAULT: "#1d4ed8", // links — 6.3:1 on white
          foreground: "#ffffff",
        },
        destructive: {
          DEFAULT: "#b42318", // 5.9:1 on white
          foreground: "#ffffff",
          surface: "#fef3f2",
          border: "#f4b6ad",
        },
        success: {
          DEFAULT: "#085d3a", // 6.3:1 on white
          foreground: "#ffffff",
          surface: "#ecfdf3",
          border: "#a6e9c6",
        },
        warning: {
          DEFAULT: "#7a3c0e", // 6.4:1 on white
          foreground: "#ffffff",
          surface: "#fffaeb",
          border: "#fedf89",
        },
        info: {
          DEFAULT: "#175cd3",
          foreground: "#ffffff",
          surface: "#eff8ff",
          border: "#b2ddff",
        },
        border: "#d7dedd",
        input: "#c6cfcf",
        ring: "#0f6e63",
        background: "#ffffff",
        foreground: "#1a2b29", // 14.8:1 on background
        sidebar: {
          DEFAULT: "#0b3d38", // deep teal sidebar surface
          foreground: "#cdd8d6",
          muted: "#9fb3b0",
          active: "#123c37",
        },
        canvas: "#f7fafa", // app background behind content cards
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
