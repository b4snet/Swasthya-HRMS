/**
 * Local DEV login helper (NOT used in CI — refuses to run there).
 *
 * Sets ONE fixed, shared dev password for every seeded/E2E account so
 * developers do not have to track per-run one-time passwords. Re-running is
 * idempotent: the same password is re-confirmed, never rotated.
 *
 * SECURITY: this password is a DEV-ONLY convenience for the synthetic local
 * database (same posture as the dev DB credentials in docker-compose.yml).
 * It must never be used in any shared/production environment. CI keeps
 * per-run random bootstrap passwords (SEED_CI_* in prisma/seed.ts) and this
 * script hard-exits when CI=true.
 *
 * Override the default with E2E_PASSWORD=<value>.
 *
 * Usage: pnpm tsx scripts/e2e-users.ts
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;
const TENANT_SLUG = "swasthya-pilot";

const DEV_PASSWORD = process.env.E2E_PASSWORD || "SwasthyaDev!2026";

const ACCOUNTS = [
  "admin@swasthya-pilot.local", // seed SUPER_ADMIN
  "employee@swasthya-pilot.local", // seed EMPLOYEE (denied-state testing)
  "e2e-admin@swasthya-pilot.local", // Playwright admin
  "e2e-employee@swasthya-pilot.local", // Playwright employee
] as const;

async function main() {
  if (process.env.CI === "true") {
    throw new Error("Refusing to set a shared dev password in CI (CI=true).");
  }

  for (const email of ACCOUNTS) {
    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      console.log(`SKIP ${email} (not found — run \`pnpm db:seed\` first)`);
      continue;
    }
    const alreadySet = await bcrypt.compare(
      DEV_PASSWORD,
      (await prisma.user.findFirstOrThrow({ where: { id: user.id }, select: { passwordHash: true } }))
        .passwordHash ?? "",
    );
    if (!alreadySet) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS),
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }
    console.log(`OK   ${email}`);
  }
  console.log("\nShared dev password applied to all listed accounts (idempotent, no rotation).");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
