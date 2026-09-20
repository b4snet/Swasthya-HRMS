import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: {
    default: "Swasthya HRMS",
    template: "%s · Swasthya HRMS",
  },
  description:
    "Healthcare-grade Human Resources Management System. Workforce data owned by HRMS; consumed by HMS via explicit contracts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ToastProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-md"
          >
            Skip to main content
          </a>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
