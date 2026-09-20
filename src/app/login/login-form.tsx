"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { loginAction } from "./actions";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ title: string; message?: string } | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const parsed = schema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      setError({
        title: "Check your entries",
        message: "Enter a valid email address and your password.",
      });
      return;
    }
    setPending(true);
    try {
      const result = await loginAction(parsed.data);
      if (result?.error) {
        setError({ title: result.error });
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} noValidate>
      {error ? (
        <div role="alert" className="mb-4">
          <ErrorState title={error.title} message={error.message} />
        </div>
      ) : null}
      <div className="space-y-5">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            invalid={Boolean(error)}
            aria-describedby="login-help"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1.5"
          />
        </div>
        <p id="login-help" className="text-2xs text-muted-foreground">
          All sign-in activity is logged for security review.
        </p>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    </form>
  );
}
