import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck, Stethoscope, Users } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const BRAND_POINTS = [
  {
    icon: Users,
    title: "Workforce at a glance",
    text: "Roster, organization units, credentials and contracts — one calm surface.",
  },
  {
    icon: ShieldCheck,
    title: "Expiry radar",
    text: "Licences and fixed-term contracts flagged before they lapse.",
  },
  {
    icon: Stethoscope,
    title: "Audit-first by design",
    text: "Every material action recorded with who, what, when and where.",
  },
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-1/2 flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex xl:p-14">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
              <Stethoscope aria-hidden="true" className="size-5 text-white" />
            </span>
            <div className="leading-tight">
              <p className="text-base font-semibold tracking-tight text-white">Swasthya HRMS</p>
              <p className="text-2xs text-sidebar-muted">Healthcare workforce operations</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-md text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl">
            Keep every licence, contract and colleague organised.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-sidebar-foreground">
            A single place for your people operations — from onboarding to renewal windows — with
            security and audit by default.
          </p>
          <ul className="mt-10 space-y-6">
            {BRAND_POINTS.map((point) => (
              <li key={point.title} className="flex items-start gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <point.icon aria-hidden="true" className="size-4 text-white" />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{point.title}</p>
                  <p className="mt-0.5 max-w-sm text-2xs leading-relaxed text-sidebar-foreground">
                    {point.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-2xs text-sidebar-muted">
          Authorized use only · All activity is audited · WCAG 2.2 AA
        </p>
      </aside>

      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-10"
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Stethoscope aria-hidden="true" className="size-6 text-primary" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
              Swasthya HRMS
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Healthcare-grade workforce management
            </p>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your work credentials to continue.
          </p>
          <div className="mt-6 rounded-2xl border border-border bg-background p-6 shadow-card">
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}