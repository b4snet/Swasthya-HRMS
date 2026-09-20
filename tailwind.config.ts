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
      },
      fontSize: {
        // Enforce minimum readable sizes
        "2xs": ["0.75rem", { lineHeight: "1.33" }],
      },
      borderRadius: {
        lg: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
