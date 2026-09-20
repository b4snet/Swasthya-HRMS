import { test, expect, CREDENTIALS_MISSING } from "./fixtures";

/**
 * Critical Phase 2 journey (plan §9):
 *   login → employee directory → create synthetic employee →
 *   assign department/position → view employee → change assignment →
 *   inspect history → authorization denial for a non-HR account.
 *
 * Runs against a REAL migrated + seeded database; without E2E credentials
 * the suite SKIPS (never fails on machines with no database).
 * Selectors target roles/labels, not visual styling (fragile-selector rule).
 */

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
// Employee/employment numbers must be PREFIX-YY-NNNNN (digits only after YY).
const NUMSTAMP = String(Date.now()).slice(-5);

test.describe("Employee critical journey", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("directory renders with reachable employees", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await expect(
      adminPage.getByRole("navigation", { name: "Employee sections" }).or(
        adminPage.getByRole("heading", { name: /employees/i }).first(),
      ),
    ).toBeVisible();
    // Seeded org has employees; the toolbar search must be present.
    await expect(adminPage.getByRole("searchbox", { name: "Search" })).toBeVisible();
    await expect(
      adminPage.getByRole("link", { name: /view profile/i }).first(),
    ).toBeVisible();
  });

  test("create employee via guided workflow and assign to a department/position", async ({
    adminPage,
  }) => {
    await adminPage.goto("/employees/new");

    // Step 1 — identity.
    await adminPage.getByLabel("First name").fill(`E2E${STAMP}`);
    await adminPage.getByLabel("Last name").fill("Nurse");
    await adminPage.getByRole("button", { name: /next: employment/i }).click();

    // Step 2 — employment.
    await adminPage.getByLabel("Employee No.").fill(`EMP-26-${NUMSTAMP}`);
    await adminPage.getByLabel("Employment No.").fill(`EMP-26-${NUMSTAMP}`);
    await adminPage.getByLabel("Hire date").fill("2026-01-05");
    await adminPage.getByRole("button", { name: /create employee/i }).click();

    // Step 3 — optional initial assignment: pick a department if available.
    const deptSelect = adminPage.getByLabel("Department");
    if (await deptSelect.isVisible().catch(() => false)) {
      const optionCount = await deptSelect.locator("option").count();
      if (optionCount > 1) await deptSelect.selectOption({ index: 1 });
    }
    await adminPage.getByRole("button", { name: /create assignment & finish/i }).click();

    // Profile rendered.
    await expect(
      adminPage.getByRole("heading", { name: new RegExp(`E2E${STAMP}`) }),
    ).toBeVisible();
    // Sensitive DOB renders as Restricted for admin WITHOUT the sensitive grant
    // (SUPER_ADMIN holds the permission but the SENSITIVE scope is a separate grant).
    await expect(adminPage.getByText("Restricted").first()).toBeVisible();
  });

  test("change assignment with handover date and inspect history", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    // Open the first profile in the directory (seeded employee).
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Assignments", exact: true }).click();

    const change = adminPage.getByRole("button", { name: /change assignment|new assignment/i });
    await expect(change).toBeVisible();
    await change.click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const hasOpen = await dialog.getByLabel("Close current at").isVisible().catch(() => false);
    if (hasOpen) {
      await dialog.getByLabel("Close current at").fill("2026-06-30");
    }
    await dialog.getByLabel("Effective from").fill("2026-07-01");
    await dialog.getByRole("button", { name: /save assignment/i }).click();
    await expect(dialog).toBeHidden();

    // History sections render current + historical without flattening.
    await expect(adminPage.getByText(/historical assignments/i)).toBeVisible();
  });

  test("audit history is reachable from the profile", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("button", { name: /history/i }).first().click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Either audit entries render (code = event action) or the explicit empty
    // state does — both are valid outcomes for a fresh seeded profile.
    await expect(
      dialog.locator("code").first().or(dialog.getByText(/no audit events yet/i)),
    ).toBeVisible();
  });

  test("directory export button exists (CSV of authorized rows only)", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await expect(adminPage.getByRole("button", { name: /export/i })).toBeVisible();
  });
});

test.describe("Employee permission denial", () => {
  const hasEmployee = Boolean(process.env.E2E_EMPLOYEE_EMAIL && process.env.E2E_EMPLOYEE_PASSWORD);
  test.skip(
    !hasEmployee || CREDENTIALS_MISSING,
    "Requires E2E_EMPLOYEE_EMAIL / E2E_EMPLOYEE_PASSWORD (seeded CI)",
  );

  test("plain employee cannot read the directory", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_EMPLOYEE_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_EMPLOYEE_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/);

    await page.goto("/employees");
    await expect(page.getByText(/don't have access|permission/i).first()).toBeVisible();
  });
});
