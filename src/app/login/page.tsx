import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <main
        id="main-content"
        className="flex min-h-screen items-center justify-center bg-muted px-4 py-10"
      >
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Swasthya HRMS</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Healthcare-grade workforce management
            </p>
          </div>
          <LoginForm />
        </div>
      </main>
      <footer className="p-4 text-center text-2xs text-muted-foreground">
        Authorized use only. All activity is audited.
      </footer>
    </>
  );
}
