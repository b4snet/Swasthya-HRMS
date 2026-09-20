import { test, expect, CREDENTIALS_MISSING } from "./fixtures";

/**
 * Critical Phase 1 journey (plan §9):
 *   login → organization → create department → create team →
 *   create/view position → view organization structure →
 *   permission denial → audit record visible.
 *
 * Requires a migrated + seeded database and E2E_ADMIN_EMAIL /
 * E2E_ADMIN_PASSWORD (CI injects both; see .github/workflows/ci.yml).
 * Without credentials the whole suite SKIPS — it never fails on a machine
 * that simply has no database.
 */

test.describe("Organization critical journey", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("sign in lands on the dashboard", async ({ adminPage }) => {
    await expect(adminPage).toHaveURL(/dashboard/);
  });

  test("organization overview renders counts and sections", async ({ adminPage }) => {
    await adminPage.goto("/organization");
    await expect(adminPage.getByRole("heading", { name: /at a glance/i })).toBeVisible();
    await expect(
      adminPage.getByRole("navigation", { name: "Organization sections" }),
    ).toBeVisible();
  });

  test("create a department via dialog", async ({ adminPage }) => {
    await adminPage.goto("/organization/departments");
    const trigger = adminPage.getByRole("button", { name: /new department/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const code = `EMR${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await dialog.getByLabel(/code/i).fill(code);
    await dialog.getByLabel(/^name/i).fill(`Emergency ${code}`);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toBeHidden();
    // Row appears after refresh (server returns the scoped list).
    await expect(adminPage.getByText(code).first()).toBeVisible();
  });

  test("create a team via dialog", async ({ adminPage }) => {
    await adminPage.goto("/organization/teams");
    await adminPage.getByRole("button", { name: /new team/i }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const code = `ICU${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await dialog.getByLabel(/code/i).fill(code);
    await dialog.getByLabel(/^name/i).fill(`ICU Night ${code}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(adminPage.getByText(code).first()).toBeVisible();
  });

  test("create a position and view reporting section", async ({ adminPage }) => {
    await adminPage.goto("/organization/positions");
    await adminPage.getByRole("button", { name: /new position/i }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const code = `POS${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await dialog.getByLabel(/position code/i).fill(code);
    // Placement is required (exactly one of department or team): pick the
    // first non-empty department option; the seeded org always has one.
    const departmentSelect = dialog.getByLabel("Department");
    await departmentSelect.selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await expect(
      adminPage.getByRole("heading", { name: "Reporting relationships" }),
    ).toBeVisible();
  });

  test("structure view distinguishes structure from reporting", async ({ adminPage }) => {
    await adminPage.goto("/organization/structure");
    await expect(
      adminPage.getByRole("heading", { name: "Structural hierarchy" }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("heading", { name: "Reporting relationships" }),
    ).toBeVisible();
  });

  test("audit history dialog shows entries for a created record", async ({ adminPage }) => {
    await adminPage.goto("/organization/departments");
    const tableVisible = await adminPage
      .getByRole("table")
      .isVisible()
      .catch(() => false);
    test.skip(!tableVisible, "No departments yet — empty state shown");
    const history = adminPage.getByRole("button", { name: "History" }).first();
    await history.click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/org\.department\./).first()).toBeVisible();
  });

  test("responsive layout keeps nav accessible at small viewports", async ({ adminPage }) => {
    await adminPage.setViewportSize({ width: 375, height: 667 });
    await adminPage.goto("/organization");
    await expect(
      adminPage.getByRole("navigation", { name: "Organization sections" }),
    ).toBeVisible();
  });
});

test.describe("Permission denial (employee role)", () => {
  const hasEmployee = Boolean(process.env.E2E_EMPLOYEE_EMAIL && process.env.E2E_EMPLOYEE_PASSWORD);

  test.skip(
    !hasEmployee,
    "Requires E2E_EMPLOYEE_EMAIL / E2E_EMPLOYEE_PASSWORD (seeded CI)",
  );

  test("employee cannot open organization admin pages", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_EMPLOYEE_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_EMPLOYEE_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/);

    await page.goto("/organization/departments");
    await expect(page.getByText(/don't have access|permission/i).first()).toBeVisible();
  });
});
