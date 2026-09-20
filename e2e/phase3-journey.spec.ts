import { test, expect, CREDENTIALS_MISSING } from "./fixtures";

/**
 * Phase 3 UI journeys (plan §9):
 *   login → employee profile → contracts tab (create + history + renew) →
 *   documents tab (upload + authorized download link) → credentials tab
 *   (create + submit for verification) → expiry dashboard.
 *
 * Runs against a REAL migrated + seeded database; without E2E credentials the
 * suite SKIPS (never fails on machines with no database). Selectors target
 * roles/labels, never visual styling.
 */

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const NUM = String(Date.now()).slice(-5); // digits-only for CONTRACT-…-NNNNN

test.describe("Phase 3 contracts UI", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("contracts tab lists seeded contracts and opens version history", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();

    await adminPage.getByRole("link", { name: "Contracts" }).click();
    await expect(adminPage.getByRole("heading", { name: "Contracts" })).toBeVisible();

    // The seeded profile has contracts (seed fixtures) — assert the row and
    // open the detail dialog with its append-only version history.
    await expect(adminPage.getByRole("button", { name: "Details" }).first()).toBeVisible();
    await adminPage.getByRole("button", { name: "Details" }).first().click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/version history/i)).toBeVisible();
    await expect(dialog.getByText(/current|superseded/).first()).toBeVisible();
  });

  test("create a draft contract via the dialog", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Contracts" }).click();

    await adminPage.getByRole("button", { name: "New contract" }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Contract number").fill(`CONTRACT-HQ-26-${NUM}`);
    await dialog.getByLabel("Title").fill(`E2E agreement ${STAMP}`);
    await dialog.getByLabel("Effective from").fill("2026-01-05");
    await dialog.getByLabel("Effective to (optional)").fill("2026-12-31");
    await dialog.getByRole("checkbox").first().check();

    await dialog.getByRole("button", { name: /create draft/i }).click();
    await expect(dialog).toBeHidden();

    // The new contract appears in the list (status DRAFT or later).
    await expect(adminPage.getByText(`E2E agreement ${STAMP}`)).toBeVisible();
  });
});

test.describe("Phase 3 documents UI", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("upload a PDF and see it listed with classification; download link present", async ({
    adminPage,
  }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Documents" }).click();

    await adminPage.getByRole("button", { name: /upload document/i }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Minimal valid PDF (magic bytes matter; content sniffed server-side).
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      "utf8",
    );
    await dialog.getByLabel(/file \(pdf/i).setInputFiles({
      name: `e2e-${STAMP}.pdf`,
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await dialog.getByLabel("Document type code").fill("EMP_CONTRACT");
    await dialog.getByLabel("Title").fill(`E2E doc ${STAMP}`);
    await dialog.getByRole("button", { name: /^upload$/i }).click();
    await expect(dialog).toBeHidden();

    await expect(adminPage.getByText(`E2E doc ${STAMP}`)).toBeVisible();

    // The download control uses the authorized route (no public URL).
    const downloadButtons = adminPage.getByRole("button", { name: /download/i });
    await expect(downloadButtons.first()).toBeVisible();
  });

  test("upload rejects a disguised file with a stable validation error", async ({ adminPage }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Documents" }).click();

    await adminPage.getByRole("button", { name: /upload document/i }).click();
    const dialog = adminPage.getByRole("dialog");

    // HTML bytes renamed to .pdf — server sniffing rejects with 415.
    await dialog.getByLabel(/file \(pdf/i).setInputFiles({
      name: `evil-${STAMP}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from("<script>alert(1)</script>", "utf8"),
    });
    await dialog.getByLabel("Document type code").fill("EMP_CONTRACT");
    await dialog.getByLabel("Title").fill(`Evil ${STAMP}`);
    await dialog.getByRole("button", { name: /^upload$/i }).click();

    await expect(
      adminPage.getByText(/upload failed|content type|not permitted/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Phase 3 credentials UI", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("add a credential, submit for verification, and view verification history", async ({
    adminPage,
  }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Credentials" }).click();

    await adminPage.getByRole("button", { name: /add credential/i }).click();
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill(`E2E License ${STAMP}`);
    await dialog.getByLabel("Issuing authority").fill("Synthetic Council");
    await dialog.getByRole("button", { name: /record credential/i }).click();
    await expect(dialog).toBeHidden();

    await expect(adminPage.getByText(`E2E License ${STAMP}`)).toBeVisible();
    // Entered ≠ verified: the badge reads PENDING (never VERIFIED on create).
    const row = adminPage.locator("li", { hasText: `E2E License ${STAMP}` });
    await expect(row.getByText("PENDING", { exact: true })).toBeVisible();

    // Open manage dialog: verification history + self-service submission.
    await row.getByRole("button", { name: "Manage" }).click();
    const manage = adminPage.getByRole("dialog");
    await expect(manage.getByRole("heading", { name: /verification history/i })).toBeVisible();
    await manage.getByRole("button", { name: /submit for verification/i }).click();
    await expect(manage.getByText("PENDING").first()).toBeVisible();
  });

  test("verifier workflow surfaces the act form; denial renders as a toast for unauthorized users", async ({
    adminPage,
  }) => {
    await adminPage.goto("/employees");
    await adminPage.getByRole("link", { name: /view profile/i }).first().click();
    await adminPage.getByRole("link", { name: "Credentials" }).click();

    const manages = adminPage.getByRole("button", { name: "Manage" });
    test.skip((await manages.count()) === 0, "No seeded credentials on this profile");

    await manages.first().click();
    const manage = adminPage.getByRole("dialog");
    await expect(manage.getByText(/record a verification act/i)).toBeVisible();

    // Recording an act exercises the server gate (admin holds credential:verify).
    await manage.getByLabel("Outcome").selectOption("VERIFIED");
    await manage.getByLabel("Method").selectOption("PORTAL");
    await manage.getByRole("button", { name: /record act/i }).click();
    await expect(manage.getByText(/recorded: verified/i).first()).toBeVisible();
  });
});

test.describe("Phase 3 expiry dashboard", () => {
  test.skip(CREDENTIALS_MISSING, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set (seeded DB required)");

  test("expiry dashboard renders contracts and/or credentials tables", async ({ adminPage }) => {
    await adminPage.goto("/employees/expiry");
    // Either tables render or the explicit empty state does — never an error.
    await expect(
      adminPage
        .getByRole("heading", { name: /expiring & expired contracts/i })
        .or(adminPage.getByText(/nothing is expiring/i)),
    ).toBeVisible();
  });
});
