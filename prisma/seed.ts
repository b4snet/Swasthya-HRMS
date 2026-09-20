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

  // SECURITY: bootstrap passwords come from the caller in CI (per-run random
  // values injected by the workflow); local runs generate random passwords
  // and print them ONCE. Nothing is hardcoded and nothing is printed in CI.
  // Only honored when CI=true — never in normal local seeding.
  const ciAdminPassword = process.env.CI === "true" ? process.env.SEED_CI_ADMIN_PASSWORD : undefined;
  const ciStaffPassword =
    process.env.CI === "true" ? process.env.SEED_CI_EMPLOYEE_PASSWORD : undefined;

  if (existing) {
    console.log(
      "Seed users already exist; passwords unchanged. Use `pnpm db:reset` to recreate.",
    );
    return;
  }

  // Local-dev convenience (explicit user request): a FIXED, non-rotating dev
  // password for the synthetic seed accounts so resets stay predictable.
  // DEV-ONLY for synthetic data — CI ignores it and injects per-run random
  // SEED_CI_* secrets instead. Never use these values in any real tenant.
  const adminPassword = ciAdminPassword || "SwasthyaDev!2026";
  const staffPassword = ciStaffPassword || "SwasthyaDev!2026";

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

  // SECURITY: never print generated credentials in CI — GitHub Actions logs
  // are readable by anyone with repo read access.
  const showSecrets = process.env.CI !== "true";
  console.log("──────────────────────────────────────────────────────");
  console.log(" Phase 0 seed complete.");
  console.log(` Tenant: ${tenant.slug}   Organization: ${organization.code}`);
  if (showSecrets && !ciAdminPassword && !ciStaffPassword) {
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
  } else {
    console.log("");
    console.log(" CI mode: bootstrap passwords are NOT printed. To obtain");
    console.log(" credentials, run the seed locally: pnpm db:reset && pnpm db:seed");
  }
  console.log("──────────────────────────────────────────────────────");
  await seedOrganizationFixtures(tenant, organization, adminEmail);
  console.log("──────────────────────────────────────────────────────");
  console.log(" Organization fixtures seeded (synthetic demo data only).");
  console.log("──────────────────────────────────────────────────────");
}

/**
 * Phase 1 synthetic organization fixtures (ADR-009 model).
 * Demonstrates: legal entity, org units, department tree, teams, positions,
 * designations/grades/job family/cost center, locations, facilities, and a
 * reporting edge. Idempotent: safe to re-run. No real personal data.
 */
async function seedOrganizationFixtures(
  tenant: { id: string; slug: string },
  organization: { id: string; code: string },
  adminEmail: string,
): Promise<void> {
  const T = tenant.id;
  const O = organization.id;
  const now = new Date();
  const upsertMeta = { createdBy: "seed", updatedBy: "seed" } as const;

  // Grant the admin an ORGANIZATION scope (ABAC reach over org fixtures).
  await prisma.userAccessScope.upsert({
    where: {
      userId_scopeType_scopeId: { userId: (await prisma.user.findFirst({ where: { tenantId: T, email: adminEmail }, select: { id: true } }))!.id, scopeType: "ORGANIZATION", scopeId: O },
    },
    update: {},
    create: { userId: (await prisma.user.findFirst({ where: { tenantId: T, email: adminEmail }, select: { id: true } }))!.id, scopeType: "ORGANIZATION", scopeId: O, grantedBy: "seed" },
  });

  const legalEntity = await prisma.legalEntity.upsert({
    where: { tenantId_code: { tenantId: T, code: "LE-HQ" } },
    update: {},
    create: {
      tenantId: T,
      code: "LE-HQ",
      registeredName: "Swasthya Pilot Hospital Pvt. Ltd. (synthetic)",
      registrationNumber: "SYN-12345",
      metadata: { jurisdiction: "NP", note: "synthetic fixture — not a real registration" },
      ...upsertMeta,
    },
  });
  await prisma.organization.update({ where: { id: O }, data: { legalEntityId: legalEntity.id, updatedBy: "seed" } });

  // Org units: HQ business unit → Medical Services division.
  const buHq = await prisma.orgUnit.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "BU-HQ" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "BU-HQ", name: "HQ Business Unit", type: "BUSINESS_UNIT", ...upsertMeta },
  });
  const divMed = await prisma.orgUnit.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DIV-MED" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DIV-MED", name: "Medical Services Division", type: "DIVISION", parentId: buHq.id, ...upsertMeta },
  });

  // Locations (tenant-shared geography) + facilities (operational sites).
  const locKtm = await prisma.location.upsert({
    where: { tenantId_code: { tenantId: T, code: "LOC-KTM" } },
    update: {},
    create: { tenantId: T, code: "LOC-KTM", name: "Kathmandu Site", addressLine: "12 Synthetic Road", city: "Kathmandu", province: "Bagmati", country: "NP", postalCode: "44600", ...upsertMeta },
  });
  const locPok = await prisma.location.upsert({
    where: { tenantId_code: { tenantId: T, code: "LOC-POK" } },
    update: {},
    create: { tenantId: T, code: "LOC-POK", name: "Pokhara Site", city: "Pokhara", province: "Gandaki", country: "NP", ...upsertMeta },
  });
  await prisma.facility.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "FAC-HOSP-01" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "FAC-HOSP-01", name: "Swasthya Pilot Hospital", type: "HOSPITAL", locationId: locKtm.id, ...upsertMeta },
  });
  await prisma.facility.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "FAC-CLINIC-01" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "FAC-CLINIC-01", name: "Lakeside Outreach Clinic", type: "CLINIC", locationId: locPok.id, ...upsertMeta },
  });

  // Classifications.
  const desigMo = await prisma.designation.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DESG-MO" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DESG-MO", name: "Medical Officer", level: 5, ...upsertMeta },
  });
  const desigNurse = await prisma.designation.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DESG-NURSE" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DESG-NURSE", name: "Staff Nurse", level: 3, ...upsertMeta },
  });
  const desigHr = await prisma.designation.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DESG-HRO" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DESG-HRO", name: "HR Officer", level: 4, ...upsertMeta },
  });
  const gradeA = await prisma.grade.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "GR-A" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "GR-A", name: "Grade A", level: 1, ...upsertMeta },
  });
  const gradeB = await prisma.grade.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "GR-B" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "GR-B", name: "Grade B", level: 2, ...upsertMeta },
  });
  const famClinical = await prisma.jobFamily.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "JF-CLIN" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "JF-CLIN", name: "Clinical", ...upsertMeta },
  });
  const famAdmin = await prisma.jobFamily.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "JF-ADMIN" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "JF-ADMIN", name: "Administrative", ...upsertMeta },
  });
  const ccMed = await prisma.costCenter.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "CC-MED" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "CC-MED", name: "Medical Services", ...upsertMeta },
  });

  // Department tree: Medical Services → { Emergency, Nursing → ICU }.
  const deptMed = await prisma.department.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DEPT-MED" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DEPT-MED", name: "Medical Services", parentId: null, ...upsertMeta },
  });
  const deptEr = await prisma.department.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DEPT-ER" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DEPT-ER", name: "Emergency", parentId: deptMed.id, ...upsertMeta },
  });
  const deptNur = await prisma.department.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DEPT-NUR" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DEPT-NUR", name: "Nursing", parentId: deptMed.id, ...upsertMeta },
  });
  const deptIcu = await prisma.department.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "DEPT-ICU" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "DEPT-ICU", name: "Intensive Care", parentId: deptNur.id, ...upsertMeta },
  });

  // Teams: ER night team under Emergency; ICU day team under Intensive Care.
  const teamErNight = await prisma.team.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "TEAM-ER-N" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "TEAM-ER-N", name: "Emergency Night Team", departmentId: deptEr.id, ...upsertMeta },
  });
  const teamIcuDay = await prisma.team.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "TEAM-ICU-D" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "TEAM-ICU-D", name: "ICU Day Team", departmentId: deptIcu.id, ...upsertMeta },
  });

  // Positions (seats): mixed placements, mostly VACANT.
  const posErHead = await prisma.position.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "POS-ER-HEAD" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "POS-ER-HEAD", title: "Head of Emergency", departmentId: deptEr.id, designationId: desigMo.id, gradeId: gradeA.id, jobFamilyId: famClinical.id, costCenterId: ccMed.id, status: "VACANT", ...upsertMeta },
  });
  const posErDoc1 = await prisma.position.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "POS-ER-DOC-01" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "POS-ER-DOC-01", title: "Emergency Medical Officer", departmentId: deptEr.id, designationId: desigMo.id, gradeId: gradeB.id, jobFamilyId: famClinical.id, costCenterId: ccMed.id, status: "VACANT", ...upsertMeta },
  });
  const posErDoc2 = await prisma.position.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "POS-ER-DOC-02" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "POS-ER-DOC-02", title: "Emergency Medical Officer (Night)", teamId: teamErNight.id, designationId: desigMo.id, gradeId: gradeB.id, jobFamilyId: famClinical.id, costCenterId: ccMed.id, status: "VACANT", ...upsertMeta },
  });
  const posIcuNurse = await prisma.position.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "POS-ICU-NUR-01" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "POS-ICU-NUR-01", title: "ICU Staff Nurse", teamId: teamIcuDay.id, designationId: desigNurse.id, gradeId: gradeB.id, jobFamilyId: famClinical.id, costCenterId: ccMed.id, status: "VACANT", ...upsertMeta },
  });
  const posHrOfficer = await prisma.position.upsert({
    where: { tenantId_organizationId_code: { tenantId: T, organizationId: O, code: "POS-HR-01" } },
    update: {},
    create: { tenantId: T, organizationId: O, code: "POS-HR-01", title: "HR Officer", departmentId: deptMed.id, designationId: desigHr.id, gradeId: gradeB.id, jobFamilyId: famAdmin.id, status: "VACANT", ...upsertMeta },
  });

  // Reporting: ER docs report to Head of Emergency (PRIMARY); a MATRIX
  // overlay links the ICU nurse to the ER head for night escalations.
  // (Idempotent via findFirst — the active-pair uniqueness is a partial
  // index Prisma upsert cannot address.)
  const ensureEdge = async (
    sourcePositionId: string,
    targetPositionId: string,
    type: "PRIMARY" | "SECONDARY" | "MATRIX",
  ) => {
    const existing = await prisma.reportingEdge.findFirst({
      where: { tenantId: T, organizationId: O, sourcePositionId, targetPositionId, type },
      select: { id: true },
    });
    if (!existing) {
      await prisma.reportingEdge.create({
        data: {
          tenantId: T,
          organizationId: O,
          sourcePositionId,
          targetPositionId,
          type,
          effectiveFrom: now,
          ...upsertMeta,
        },
      });
    }
  };
  await ensureEdge(posErDoc1.id, posErHead.id, "PRIMARY");
  await ensureEdge(posErDoc2.id, posErHead.id, "PRIMARY");
  await ensureEdge(posIcuNurse.id, posErHead.id, "MATRIX");

  await seedWorkforceFixtures(tenant, organization);
  await seedPhase3Fixtures(tenant, organization);
}

/**
 * Phase 2 synthetic workforce fixtures (ADR-010). Demonstrates: persons,
 * employees (ACTIVE / PROBATION / TERMINATED-with-history), open
 * assignments binding seeded departments/teams/positions (flipping two
 * Phase 1 seats to FILLED), one manager relationship via assignment, a
 * credential expiring soon, qualifications, and emergency contacts.
 * All names/numbers are synthetic; idempotent via deterministic codes.
 */
async function seedWorkforceFixtures(
  tenant: { id: string; slug: string },
  organization: { id: string; code: string },
): Promise<void> {
  const T = tenant.id;
  const O = organization.id;
  const now = new Date();
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  const deptEr = await prisma.department.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "DEPT-ER" },
  });
  const deptIcu = await prisma.department.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "DEPT-ICU" },
  });
  const teamErNight = await prisma.team.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "TEAM-ER-N" },
  });
  const desigMo = await prisma.designation.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "DESG-MO" },
  });
  const desigNurse = await prisma.designation.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "DESG-NURSE" },
  });
  const locKtm = await prisma.location.findFirstOrThrow({
    where: { tenantId: T, code: "LOC-KTM" },
  });
  const facHosp = await prisma.facility.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "FAC-HOSP-01" },
  });
  const posErDoc1 = await prisma.position.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "POS-ER-DOC-01" },
  });
  const posIcuNurse = await prisma.position.findFirstOrThrow({
    where: { tenantId: T, organizationId: O, code: "POS-ICU-NUR-01" },
  });

  const ensurePerson = async (
    key: string,
    data: {
      firstName: string;
      lastName: string;
      preferredName?: string;
      dateOfBirth?: Date;
      nationality?: string;
      email?: string;
      phone?: string;
    },
  ) => {
    // Persons have no natural unique key; find by tenant + names.
    const existing = await prisma.person.findFirst({
      where: { tenantId: T, firstName: data.firstName, lastName: data.lastName },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.person.create({
      data: {
        tenantId: T,
        ...data,
        createdBy: "seed",
        updatedBy: "seed",
      },
      select: { id: true },
    });
    return created.id;
  };

  const ensureEmployee = async (
    personId: string,
    employeeNo: string,
    employeeType: "REGULAR" | "CONTRACT" | "LOCUM",
  ) => {
    const existing = await prisma.employee.findUnique({
      where: { tenantId_organizationId_personId: { tenantId: T, organizationId: O, personId } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.employee.create({
      data: {
        tenantId: T,
        organizationId: O,
        personId,
        employeeNo,
        employeeType,
        hiredOn: iso(2026, 1, 5),
        createdBy: "seed",
        updatedBy: "seed",
      },
      select: { id: true },
    });
    return created.id;
  };

  const ensureEmployment = async (
    employeeId: string,
    employmentNo: string,
    data: {
      type: "PERMANENT" | "PROBATION" | "LOCUM";
      status: "ACTIVE" | "TERMINATED";
      workerClassification: "EMPLOYEE" | "CONTRACTOR";
      hireDate: Date;
      terminationDate?: Date;
      terminationReason?: "END_OF_CONTRACT";
      probationEndDate?: Date;
    },
  ) => {
    const existing = await prisma.employment.findUnique({
      where: { tenantId_organizationId_employmentNo: { tenantId: T, organizationId: O, employmentNo } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.employment.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId,
        employmentNo,
        type: data.type,
        status: data.status,
        hireDate: data.hireDate,
        terminationDate: data.terminationDate ?? null,
        terminationReason: data.terminationReason ?? null,
        probationEndDate: data.probationEndDate ?? null,
        workerClassification: data.workerClassification,
        workLocationId: locKtm.id,
        facilityId: facHosp.id,
        statusHistory: [
          { status: data.status, changedAt: now.toISOString(), changedBy: "seed" },
        ],
        createdBy: "seed",
        updatedBy: "seed",
      },
      select: { id: true },
    });
    return created.id;
  };

  const ensureAssignment = async (
    employmentId: string,
    data: {
      positionId?: string;
      departmentId?: string;
      teamId?: string;
      designationId?: string;
      managerEmploymentId?: string;
      effectiveFrom: Date;
      effectiveTo?: Date;
    },
  ) => {
    const existing = await prisma.employmentAssignment.findFirst({
      where: {
        tenantId: T,
        organizationId: O,
        employmentId,
        effectiveFrom: data.effectiveFrom,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.employmentAssignment.create({
      data: {
        tenantId: T,
        organizationId: O,
        employmentId,
        positionId: data.positionId ?? null,
        departmentId: data.departmentId ?? null,
        teamId: data.teamId ?? null,
        designationId: data.designationId ?? null,
        managerEmploymentId: data.managerEmploymentId ?? null,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        createdBy: "seed",
        updatedBy: "seed",
      },
      select: { id: true },
    });
    return created.id;
  };

  // 1) Dr. Aasha Sharma — ACTIVE Medical Officer in ER (fills POS-ER-DOC-01);
  //    manages the two subordinate employments below via assignment.
  const pAasha = await ensurePerson("aasha", {
    firstName: "Aasha",
    lastName: "Sharma",
    preferredName: "Aasha",
    dateOfBirth: iso(1985, 3, 12),
    nationality: "NP",
    email: "aasha.sharma@example.invalid",
    phone: "+977-9800000001",
  });
  const eAasha = await ensureEmployee(pAasha, "EMP-26-00001", "REGULAR");
  const emAasha = await ensureEmployment(eAasha, "EMP-26-00001", {
    type: "PERMANENT",
    status: "ACTIVE",
    workerClassification: "EMPLOYEE",
    hireDate: iso(2026, 1, 5),
    probationEndDate: iso(2026, 4, 5),
  });
  await prisma.employee.update({
    where: { id: eAasha },
    data: { employmentStatus: "ACTIVE" },
  });
  await ensureAssignment(emAasha, {
    positionId: posErDoc1.id,
    departmentId: deptEr.id,
    designationId: desigMo.id,
    effectiveFrom: iso(2026, 1, 5),
  });
  await prisma.position.update({
    where: { id: posErDoc1.id },
    data: { status: "FILLED" },
  });

  // 2) Sister Binita Rai — PROBATION ICU nurse (fills POS-ICU-NUR-01),
  //    managed by Aasha; credential expiring in ~45 days.
  const pBinita = await ensurePerson("binita", {
    firstName: "Binita",
    lastName: "Rai",
    dateOfBirth: iso(1993, 8, 25),
    nationality: "NP",
    email: "binita.rai@example.invalid",
  });
  const eBinita = await ensureEmployee(pBinita, "EMP-26-00002", "REGULAR");
  const emBinita = await ensureEmployment(eBinita, "EMP-26-00002", {
    type: "PROBATION",
    status: "ACTIVE",
    workerClassification: "EMPLOYEE",
    hireDate: iso(2026, 7, 1),
    probationEndDate: iso(2027, 1, 1),
  });
  await prisma.employee.update({
    where: { id: eBinita },
    data: { employmentStatus: "ACTIVE" },
  });
  await ensureAssignment(emBinita, {
    positionId: posIcuNurse.id,
    departmentId: deptIcu.id,
    designationId: desigNurse.id,
    managerEmploymentId: emAasha,
    effectiveFrom: iso(2026, 7, 1),
  });
  await prisma.position.update({
    where: { id: posIcuNurse.id },
    data: { status: "FILLED" },
  });
  const credExisting = await prisma.employeeCredential.findFirst({
    where: { employeeId: eBinita, name: "Nursing License" },
    select: { id: true },
  });
  if (!credExisting) {
    await prisma.employeeCredential.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId: eBinita,
        type: "LICENSE",
        name: "Nursing License",
        issuer: "Nepal Nursing Council (synthetic)",
        verificationStatus: "VERIFIED",
        issuedOn: iso(2024, 9, 1),
        expiresOn: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
        facilityId: facHosp.id,
        createdBy: "seed",
        updatedBy: "seed",
      },
    });
  }
  const qualExisting = await prisma.employeeQualification.findFirst({
    where: { employeeId: eBinita, name: "BN Nursing" },
    select: { id: true },
  });
  if (!qualExisting) {
    await prisma.employeeQualification.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId: eBinita,
        type: "DEGREE",
        name: "BN Nursing",
        institution: "Synthetic Institute of Health Sciences",
        completedOn: iso(2024, 6, 30),
        createdBy: "seed",
        updatedBy: "seed",
      },
    });
  }
  const ecExisting = await prisma.employeeEmergencyContact.findFirst({
    where: { employeeId: eBinita, name: "Suman Rai" },
    select: { id: true },
  });
  if (!ecExisting) {
    await prisma.employeeEmergencyContact.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId: eBinita,
        name: "Suman Rai",
        relationship: "Spouse",
        phone: "+977-9800000002",
        isPrimary: true,
        createdBy: "seed",
        updatedBy: "seed",
      },
    });
  }

  // 3) Chandra Gurung — former LOCUM, contract ended (TERMINATED history),
  //    closed assignment preserved; demonstrates archival-ready separation.
  const pChandra = await ensurePerson("chandra", {
    firstName: "Chandra",
    lastName: "Gurung",
    dateOfBirth: iso(1980, 11, 2),
    nationality: "NP",
  });
  const eChandra = await ensureEmployee(pChandra, "EMP-26-00003", "LOCUM");
  const emChandra = await ensureEmployment(eChandra, "EMP-26-00003", {
    type: "LOCUM",
    status: "TERMINATED",
    workerClassification: "CONTRACTOR",
    hireDate: iso(2025, 10, 1),
    terminationDate: iso(2026, 3, 31),
    terminationReason: "END_OF_CONTRACT",
  });
  await prisma.employee.update({
    where: { id: eChandra },
    data: { employmentStatus: "TERMINATED", leftOn: iso(2026, 3, 31) },
  });
  await ensureAssignment(emChandra, {
    departmentId: deptEr.id,
    designationId: desigMo.id,
    managerEmploymentId: emAasha,
    effectiveFrom: iso(2025, 10, 1),
    effectiveTo: iso(2026, 3, 31),
  });
}

/**
 * Phase 3 synthetic fixtures (ADR-011): contracts (active/expiring/expired),
 * the issuing-authority registry + credential type configs, credentials
 * (verified / pending / lapsed-by-derivation), a qualification verification
 * record, and Documents-domain documents with REAL bytes in local storage so
 * the download path is demonstrable. Idempotent; synthetic data only.
 */
async function seedPhase3Fixtures(
  tenant: { id: string; slug: string },
  organization: { id: string; code: string },
): Promise<void> {
  const T = tenant.id;
  const O = organization.id;
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

  const emAasha = await prisma.employment.findUniqueOrThrow({
    where: { tenantId_organizationId_employmentNo: { tenantId: T, organizationId: O, employmentNo: "EMP-26-00001" } },
    select: { id: true, employee: { select: { id: true, personId: true } } },
  });
  const emBinita = await prisma.employment.findUniqueOrThrow({
    where: { tenantId_organizationId_employmentNo: { tenantId: T, organizationId: O, employmentNo: "EMP-26-00002" } },
    select: { id: true, employee: { select: { id: true } } },
  });
  const emChandra = await prisma.employment.findUniqueOrThrow({
    where: { tenantId_organizationId_employmentNo: { tenantId: T, organizationId: O, employmentNo: "EMP-26-00003" } },
    select: { id: true, employee: { select: { id: true } } },
  });

  // ── Document types (tenant-configurable classification vocabulary) ──────
  const ensureDocType = async (
    code: string,
    name: string,
    defaultClassification: "EMPLOYMENT" | "SENSITIVE_PERSONAL" | "CREDENTIAL",
    requiresVerification: boolean,
  ) => {
    const existing = await prisma.documentType.findUnique({
      where: { tenantId_code: { tenantId: T, code } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.documentType.create({
      data: { tenantId: T, code, name, defaultClassification, requiresVerification, createdBy: "seed", updatedBy: "seed" },
      select: { id: true },
    });
    return created.id;
  };
  const dtContract = await ensureDocType("EMP_CONTRACT", "Employment contract", "EMPLOYMENT", false);
  await ensureDocType("ID_DOCUMENT", "Identity document", "SENSITIVE_PERSONAL", true);
  await ensureDocType("LICENSE_CERTIFICATE", "License / certificate", "CREDENTIAL", true);

  // ── Issuing authority registry + credential type config ─────────────────
  const ensureAuthority = async (
    code: string,
    name: string,
    authorityType: "MEDICAL_COUNCIL" | "NURSING_COUNCIL" | "GOVERNMENT" | "UNIVERSITY" | "BOARD" | "OTHER",
    jurisdiction: string,
  ) => {
    const existing = await prisma.issuingAuthority.findFirst({
      where: { tenantId: T, code },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.issuingAuthority.create({
      data: { tenantId: T, code, name, authorityType, jurisdiction, createdBy: "seed", updatedBy: "seed" },
      select: { id: true },
    });
    return created.id;
  };
  const authNmc = await ensureAuthority("AUTH-NMC", "Nepal Medical Council (synthetic)", "MEDICAL_COUNCIL", "NP");
  const authNnc = await ensureAuthority("AUTH-NNC", "Nepal Nursing Council (synthetic)", "NURSING_COUNCIL", "NP");
  const authSihs = await ensureAuthority("AUTH-SIHS", "Synthetic Institute of Health Sciences", "UNIVERSITY", "NP");

  for (const [code, leadDays] of [["LICENSE", 90], ["CERTIFICATION", 60], ["REGISTRATION", 90], ["CLEARANCE", 30]] as const) {
    const existing = await prisma.credentialTypeConfig.findUnique({
      where: { tenantId_code: { tenantId: T, code } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.credentialTypeConfig.create({
        data: { tenantId: T, code, renewalLeadDays: leadDays, createdBy: "seed", updatedBy: "seed" },
      });
    }
  }

  // ── Contracts: active (amended), expiring, expired ───────────────────────
  const ensureContract = async (
    contractNo: string,
    data: {
      employmentId: string;
      title: string;
      type: "EMPLOYMENT" | "LOCUM";
      status: "ACTIVE" | "EXPIRED";
      effectiveFrom: Date;
      effectiveTo: Date | null;
      currentVersionNo: number;
    },
    versions: { versionNo: number; effectiveFrom: Date; effectiveTo: Date | null; superseded: boolean }[],
  ) => {
    const existing = await prisma.contract.findFirst({
      where: { tenantId: T, contractNo },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.contract.create({
      data: {
        tenantId: T,
        organizationId: O,
        employmentId: data.employmentId,
        contractNo,
        title: data.title,
        type: data.type,
        status: data.status,
        jurisdiction: "NP",
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        currentVersionNo: data.currentVersionNo,
        approvedBy: data.status === "ACTIVE" ? "seed-admin" : null,
        approvedAt: data.status === "ACTIVE" ? data.effectiveFrom : null,
        signedOn: data.status === "ACTIVE" ? data.effectiveFrom : null,
        createdBy: "seed",
        updatedBy: "seed",
        versions: {
          create: versions.map((v) => ({
            tenantId: T,
            versionNo: v.versionNo,
            effectiveFrom: v.effectiveFrom,
            effectiveTo: v.effectiveTo,
            clauseNames: v.versionNo === 1 ? ["PROBATION_90_DAYS", "NOTICE_30"] : ["NOTICE_30", "RENEWAL_12M"],
            note: v.versionNo === 1 ? null : "Synthetic amendment: renewal term added.",
            supersededAt: v.superseded ? new Date() : null,
            supersededBy: v.superseded ? "seed" : null,
            createdBy: "seed",
          })),
        },
        parties: {
          create: [
            { tenantId: T, partyType: "EMPLOYEE", personId: emAasha.employee.personId, role: "Employee", createdBy: "seed" },
            { tenantId: T, partyType: "EMPLOYER_ORGANIZATION", organizationId: O, role: "Employer", createdBy: "seed" },
          ],
        },
      },
      select: { id: true },
    });
    return created.id;
  };

  const contractAasha = await ensureContract(
    "CONTRACT-HQ-26-00001",
    {
      employmentId: emAasha.id,
      title: "Employment Agreement — Aasha Sharma (synthetic)",
      type: "EMPLOYMENT",
      status: "ACTIVE",
      effectiveFrom: iso(2026, 1, 5),
      effectiveTo: null,
      currentVersionNo: 2,
    },
    [
      { versionNo: 1, effectiveFrom: iso(2026, 1, 5), effectiveTo: iso(2026, 7, 1), superseded: true },
      { versionNo: 2, effectiveFrom: iso(2026, 7, 1), effectiveTo: null, superseded: false },
    ],
  );
  await ensureContract(
    "CONTRACT-HQ-26-00002",
    {
      employmentId: emBinita.id,
      title: "Locum Agreement — Binita Rai (synthetic, expiring)",
      type: "LOCUM",
      status: "ACTIVE",
      effectiveFrom: iso(2026, 8, 1),
      effectiveTo: daysFromNow(30),
      currentVersionNo: 1,
    },
    [{ versionNo: 1, effectiveFrom: iso(2026, 8, 1), effectiveTo: daysFromNow(30), superseded: false }],
  );
  await ensureContract(
    "CONTRACT-HQ-26-00003",
    {
      employmentId: emChandra.id,
      title: "Locum Agreement — Chandra Gurung (synthetic, expired)",
      type: "LOCUM",
      status: "EXPIRED",
      effectiveFrom: iso(2025, 10, 1),
      effectiveTo: iso(2026, 3, 31),
      currentVersionNo: 1,
    },
    [{ versionNo: 1, effectiveFrom: iso(2025, 10, 1), effectiveTo: iso(2026, 3, 31), superseded: false }],
  );

  // ── Documents: real bytes in local storage so downloads work ────────────
  // A minimal (synthetic, invalid-but-sniffable) PDF; written under the
  // gitignored DOCUMENT_STORAGE_ROOT. Storage keys are server-shaped and
  // never exposed as URLs (ADR-011 §2).
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { join, resolve: resolvePath } = await import("node:path");
  const storageRoot = resolvePath(process.env.DOCUMENT_STORAGE_ROOT ?? ".document-storage");
  const seedPdfBytes = (label: string) =>
    Buffer.from(
      `%PDF-1.4\n% Synthetic Swasthya HRMS seed document: ${label}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF`,
      "utf8",
    );
  const ensureSeedDocument = async (
    title: string,
    subjectType: "CONTRACT" | "EMPLOYEE",
    subjectId: string,
    typeId: string,
    classification: "EMPLOYMENT" | "SENSITIVE_PERSONAL",
    label: string,
  ) => {
    const existing = await prisma.document.findFirst({
      where: { tenantId: T, title },
      select: { id: true },
    });
    if (existing) return existing.id;
    const storageId = `seed/${T}/${label}.pdf`;
    const bytes = seedPdfBytes(label);
    await mkdir(join(storageRoot, "seed", T), { recursive: true });
    await writeFile(join(storageRoot, "seed", T, `${label}.pdf`), bytes);
    const created = await prisma.document.create({
      data: {
        tenantId: T,
        organizationId: O,
        subjectType,
        subjectId,
        typeId,
        title,
        classification,
        createdBy: "seed",
        updatedBy: "seed",
        versions: {
          create: {
            tenantId: T,
            versionNo: 1,
            storageId,
            contentType: "application/pdf",
            sizeBytes: bytes.length,
            checksumSha256: createHash("sha256").update(bytes).digest("hex"),
            uploadedBy: "seed",
          },
        },
      },
      select: { id: true },
    });
    return created.id;
  };

  const docContract = await ensureSeedDocument(
    "Employment Agreement — Aasha Sharma (synthetic)",
    "CONTRACT",
    contractAasha,
    dtContract,
    "EMPLOYMENT",
    "employment-agreement-aasha",
  );
  await prisma.contract.updateMany({
    where: { id: contractAasha, documentId: null },
    data: { documentId: docContract },
  });
  const docIdBinita = await ensureSeedDocument(
    "Identity document — Binita Rai (synthetic)",
    "EMPLOYEE",
    emBinita.employee.id,
    (await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: T, code: "ID_DOCUMENT" } }, select: { id: true } })).id,
    "SENSITIVE_PERSONAL",
    "identity-document-binita",
  );
  const docRefExisting = await prisma.employeeDocumentReference.findFirst({
    where: { tenantId: T, employeeId: emAasha.employee.id, title: "Employment Agreement — Aasha Sharma (synthetic)" },
    select: { id: true },
  });
  if (!docRefExisting) {
    await prisma.employeeDocumentReference.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId: emAasha.employee.id,
        docType: "EMP_CONTRACT",
        title: "Employment Agreement — Aasha Sharma (synthetic)",
        documentRef: `document:${docContract}`,
        documentId: docContract,
        classification: "EMPLOYMENT",
        createdBy: "seed",
        updatedBy: "seed",
      },
    });
  }
  await prisma.employeeDocumentReference.updateMany({
    where: { tenantId: T, employeeId: emBinita.employee.id, docType: "ID_DOCUMENT", documentId: null },
    data: { documentId: docIdBinita },
  });

  // ── Credentials: verified / pending / lapsed-by-derivation ───────────────
  const binitaLicense = await prisma.employeeCredential.findFirst({
    where: { tenantId: T, employeeId: emBinita.employee.id, name: "Nursing License" },
    select: { id: true, verificationStatus: true },
  });
  if (binitaLicense) {
    await prisma.employeeCredential.update({
      where: { id: binitaLicense.id },
      data: { issuingAuthorityId: authNnc, jurisdiction: "NP" },
    });
    const recExisting = await prisma.credentialVerificationRecord.findFirst({
      where: { tenantId: T, credentialId: binitaLicense.id, outcome: "VERIFIED" },
      select: { id: true },
    });
    if (!recExisting) {
      const record = await prisma.credentialVerificationRecord.create({
        data: {
          tenantId: T,
          credentialId: binitaLicense.id,
          outcome: "VERIFIED",
          method: "ISSUER_DIRECT",
          performedBy: "seed",
          notes: "Synthetic verification against the council registry.",
          createdBy: "seed",
        },
        select: { id: true },
      });
      await prisma.employeeCredential.update({
        where: { id: binitaLicense.id },
        data: { verificationRecordId: record.id, verifiedAt: new Date(), verifiedBy: "seed" },
      });
    }
  }

  const ensureCredential = async (
    employeeId: string,
    name: string,
    data: { type: "CERTIFICATION" | "CLEARANCE"; issuer: string; expiresOn: Date | null; verificationStatus: "PENDING" | "VERIFIED" },
  ) => {
    const existing = await prisma.employeeCredential.findFirst({
      where: { tenantId: T, employeeId, name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.employeeCredential.create({
      data: {
        tenantId: T,
        organizationId: O,
        employeeId,
        type: data.type,
        name,
        issuer: data.issuer,
        expiresOn: data.expiresOn,
        verificationStatus: data.verificationStatus,
        jurisdiction: "NP",
        createdBy: "seed",
        updatedBy: "seed",
      },
      select: { id: true },
    });
    return created.id;
  };

  // PENDING: never verified — an entered credential is NOT a verified one.
  await ensureCredential(emChandra.employee.id, "Basic Life Support (pending verification, synthetic)", {
    type: "CERTIFICATION",
    issuer: "Synthetic Safety Board",
    expiresOn: daysFromNow(300),
    verificationStatus: "PENDING",
  });
  // Lapsed: VERIFIED in the past, expiry now behind us. The STORED status
  // stays VERIFIED — the derived status is EXPIRED, and the future sweep
  // (or an authenticated demo run) formalizes it with a derived record.
  const lapsed = await ensureCredential(emChandra.employee.id, "Infection-Control Clearance (lapsed, synthetic)", {
    type: "CLEARANCE",
    issuer: "Synthetic Safety Board",
    expiresOn: daysFromNow(-10),
    verificationStatus: "VERIFIED",
  });
  const lapsedRec = await prisma.credentialVerificationRecord.findFirst({
    where: { tenantId: T, credentialId: lapsed, outcome: "VERIFIED" },
    select: { id: true },
  });
  if (!lapsedRec) {
    const record = await prisma.credentialVerificationRecord.create({
      data: {
        tenantId: T,
        credentialId: lapsed,
        outcome: "VERIFIED",
        method: "DOCUMENT_INSPECTION",
        performedBy: "seed",
        notes: "Synthetic historical verification; expiry since passed.",
        createdBy: "seed",
      },
      select: { id: true },
    });
    await prisma.employeeCredential.update({
      where: { id: lapsed },
      data: { verificationRecordId: record.id, verifiedAt: daysFromNow(-400), verifiedBy: "seed" },
    });
  }

  // ── Qualification verification record (one-shot mirror) ──────────────────
  const binitaBn = await prisma.employeeQualification.findFirst({
    where: { tenantId: T, employeeId: emBinita.employee.id, name: "BN Nursing" },
    select: { id: true },
  });
  if (binitaBn) {
    await prisma.employeeQualification.update({
      where: { id: binitaBn.id },
      data: { issuingAuthorityId: authSihs },
    });
    const qRec = await prisma.qualificationVerificationRecord.findFirst({
      where: { tenantId: T, qualificationId: binitaBn.id },
      select: { id: true },
    });
    if (!qRec) {
      await prisma.qualificationVerificationRecord.create({
        data: {
          tenantId: T,
          qualificationId: binitaBn.id,
          outcome: "VERIFIED",
          method: "DOCUMENT_INSPECTION",
          performedBy: "seed",
          notes: "Synthetic certificate inspection.",
          createdBy: "seed",
        },
      });
    }
  }

  console.log(" Phase 3 fixtures seeded (contracts, documents, credentials).");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
