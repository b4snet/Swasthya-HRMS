import { test as base, expect, type Page } from "@playwright/test";

/**
 * E2E harness for the Organization journeys (seeded mode).
 *
 * The suite runs against a REAL migrated + seeded database: CI boots Postgres
 * and provisions credentials via environment (see .github/workflows/ci.yml,
 * e2e-check job); locally, run `docker compose up` + `pnpm db:migrate` +
 * `pnpm db:seed` and export the same variables.
 *
 * SECURITY: credentials are never committed and never printed in CI. The
 * seed accepts a CI-only bootstrap password via SEED_CI_ADMIN_PASSWORD
 * (random per CI run, injected by the workflow), keeping the "no secrets in
 * logs/repo" rule intact. Without credentials the suite SKIPS (never fails).
 */
export const CREDENTIALS_MISSING = !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD;

export async function loginAs(page: Page, email: string, password: string, expectUrl: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(expectUrl);
}

export async function loginAsAdmin(page: Page) {
  await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!, /dashboard/);
}

export interface TestFixtures {
  /** A page signed in as the seeded admin (SUPER_ADMIN) user. */
  adminPage: Page;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright worker fixture, not a React component
  adminPage: async ({ page }, use) => {
    await loginAsAdmin(page);
    await use(page);
  },
});

export { expect };
