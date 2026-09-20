"use server";

import { redirect } from "next/navigation";
import { logout } from "@/modules/identity/service";
import { getSessionUser } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/request-context";

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  const ctx = await getRequestAuditContext();
  if (user) {
    await logout(user, ctx);
  }
  redirect("/login");
}
