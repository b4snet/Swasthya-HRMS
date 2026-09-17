/**
 * Phase 0 seed: bootstrap tenant, organization, and two users.
 *
 * SECURITY:
 * - Admin password is generated randomly (crypto-strong) and printed ONCE to
 *   stdout. It is never hardcoded, never written to a file, never committed.
 * - Re-running the seed does NOT rotate existing passwords (message only).
 * - For shared environments, bootstrap via a secrets manager instead.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

function generatePassword(): string {
  // ~192 bits of entropy, URL-safe.
  return randomBytes(24).toString("base64url");
}

async function main() {
  const tenantSlug = process.env.SEED_TENANT_SLUG || "swasthya-pilot";
  const orgName = process.env.SEED_ORG_NAME || "Swasthya Pilot Hospital";

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: {},
    create: { slug: tenantSlug, name: orgName, createdBy: "seed" },
  });

  const organization = await prisma.organization.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "HQ" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: orgName,
      code: "HQ",
      createdBy: "seed",
    },
  });

  const adminEmail = `admin@${tenantSlug}.local`;
  const staffEmail = `employee@${tenantSlug}.local`;
  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: { in: [adminEmail, staffEmail] } },
    select: { email: true },
  });

  if (existing) {
    console.log(
      "Seed users already exist; passwords unchanged. Use `pnpm db:reset` to recreate.",
    );
    return;
  }

  const adminPassword = generatePassword();
  const staffPassword = generatePassword();

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      organizationId: organization.id,
      email: adminEmail,
      name: "System Administrator",
      systemRole: "SYSTEM_ROLE_SUPER_ADMIN",
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(adminPassword, BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      createdBy: "seed",
    },
  });

  // Ordinary employee account for testing permission-denied states.
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      organizationId: organization.id,
      email: staffEmail,
      name: "Demo Employee",
      systemRole: "SYSTEM_ROLE_EMPLOYEE",
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(staffPassword, BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      createdBy: "seed",
    },
  });

  console.log("──────────────────────────────────────────────────────");
  console.log(" Phase 0 seed complete.");
  console.log(` Tenant: ${tenant.slug}   Organization: ${organization.code}`);
  console.log("");
  console.log(` Admin:    ${adminEmail}`);
  console.log(` Password: ${adminPassword}`);
  console.log("");
  console.log(` Employee: ${staffEmail}`);
  console.log(` Password: ${staffPassword}`);
  console.log("");
  console.log(" ⚠  These passwords are shown ONCE and are not stored in");
  console.log("    plaintext anywhere. Copy them now into your password");
  console.log("    manager. Use `pnpm db:reset && pnpm db:seed` to rotate.");
  console.log("──────────────────────────────────────────────────────");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
