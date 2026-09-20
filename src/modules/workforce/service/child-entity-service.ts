/**
 * Workforce child-entity services (Phase 2, prompt 3).
 *
 * Emergency contacts, dependents, document references, credentials and
 * qualifications hang off Employee. Authorization = employee:manage /
 * employee:read + org reach (same as the parent employee). Deletes are
 * soft (status ARCHIVED) for dependents/credentials/qualifications that
 * may anchor history; emergency contacts and document references are
 * mutable contact/metadata rows — deactivation, not destruction, still
 * applies. All writes audited in the same transaction.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { assertMaskedDocumentNumber } from "../domain/relationships";
import { WorkforceAppError, toWorkforceAppError } from "./app-errors";
import {
  assertCallerCanManageEmployees,
  assertCallerCanReadEmployees,
  assertSensitiveAccess,
  assertVersionMatches,
  notFound,
  transactWithAudit,
} from "./mutations";
import type { WorkforceSubject } from "./types";

type Tx = Prisma.TransactionClient;

/** Shared: the employee must exist in the caller's tenant + organization. */
async function loadEmployeeInScope(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<{ id: string }> {
  const employee = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      tenantId: caller.tenantId,
      organizationId,
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });
  if (!employee) notFound("Employee");
  return employee;
}

// ── Emergency contacts ───────────────────────────────────────────────────────

export interface EmergencyContactInput {
  organizationId: string;
  employeeId: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string | null;
  isPrimary?: boolean;
}

export async function createEmergencyContact(
  caller: WorkforceSubject,
  input: EmergencyContactInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.emergency_contact.created",
        resourceType: "EmployeeEmergencyContact",
        resourceId: created.id,
        after: { employeeId: input.employeeId, name: input.name, relationship: input.relationship },
      }),
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true },
        });
        if (!employee) notFound("Employee");
        if (input.isPrimary) {
          await tx.employeeEmergencyContact.updateMany({
            where: { employeeId: employee.id, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return tx.employeeEmergencyContact.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            name: input.name,
            relationship: input.relationship,
            phone: input.phone,
            email: input.email ?? null,
            isPrimary: input.isPrimary ?? false,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function updateEmergencyContact(
  caller: WorkforceSubject,
  organizationId: string,
  contactId: string,
  input: {
    name?: string;
    relationship?: string;
    phone?: string;
    email?: string | null;
    isPrimary?: boolean;
    expectedVersion: number;
  },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.emergency_contact.updated",
        resourceType: "EmployeeEmergencyContact",
        resourceId: contactId,
      },
      async (tx) => {
        const contact = await tx.employeeEmergencyContact.findFirst({
          where: {
            id: contactId,
            tenantId: caller.tenantId,
            organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true, version: true, employeeId: true },
        });
        if (!contact) notFound("Emergency contact");
        assertVersionMatches(contact, input.expectedVersion, "Emergency contact");
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        if (input.name !== undefined) data.name = input.name;
        if (input.relationship !== undefined) data.relationship = input.relationship;
        if (input.phone !== undefined) data.phone = input.phone;
        if (input.email !== undefined) data.email = input.email;
        if (input.isPrimary === true) {
          await tx.employeeEmergencyContact.updateMany({
            where: { employeeId: contact.employeeId, isPrimary: true, id: { not: contact.id } },
            data: { isPrimary: false },
          });
          data.isPrimary = true;
        } else if (input.isPrimary === false) {
          data.isPrimary = false;
        }
        await tx.employeeEmergencyContact.update({ where: { id: contact.id }, data });
        return { id: contact.id };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listEmergencyContacts(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    relationship: string;
    phone: string;
    email: string | null;
    isPrimary: boolean;
  }>
> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    await loadEmployeeInScope(caller, organizationId, employeeId);
    const rows = await prisma.employeeEmergencyContact.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId, status: { not: "ARCHIVED" } },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        relationship: true,
        phone: true,
        email: true,
        isPrimary: true,
      },
    });
    return rows;
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Dependents ───────────────────────────────────────────────────────────────

export interface DependentInput {
  organizationId: string;
  employeeId: string;
  name: string;
  relationship: "SPOUSE" | "CHILD" | "PARENT" | "OTHER";
  /** SENSITIVE_PERSONAL — masked projection applies (plan §7). */
  dateOfBirth?: Date | null;
}

export async function createDependent(
  caller: WorkforceSubject,
  input: DependentInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.dependent.created",
        resourceType: "EmployeeDependent",
        resourceId: created.id,
        // DOB deliberately omitted from the payload (SENSITIVE_PERSONAL).
        after: { employeeId: input.employeeId, name: input.name, relationship: input.relationship },
      }),
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true },
        });
        if (!employee) notFound("Employee");
        return tx.employeeDependent.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            name: input.name,
            relationship: input.relationship,
            dateOfBirth: input.dateOfBirth ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/**
 * Update a dependent. DOB changes REQUIRE the sensitive permission + grant
 * (via assertSensitiveAccess) — an HR officer without the sensitive grant
 * may edit the name but not the birth date.
 */
export async function updateDependent(
  caller: WorkforceSubject,
  organizationId: string,
  dependentId: string,
  input: {
    name?: string;
    relationship?: "SPOUSE" | "CHILD" | "PARENT" | "OTHER";
    dateOfBirth?: Date | null;
    expectedVersion: number;
  },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    if (input.dateOfBirth !== undefined) {
      // Sensitive-field write path — must be lazy-imported? No: static
      // import is fine (same layer); guard before any write.
      await guardSensitiveWrite(caller, organizationId);
    }
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.dependent.updated",
        resourceType: "EmployeeDependent",
        resourceId: dependentId,
      },
      async (tx) => {
        const dependent = await tx.employeeDependent.findFirst({
          where: {
            id: dependentId,
            tenantId: caller.tenantId,
            organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true, version: true },
        });
        if (!dependent) notFound("Dependent");
        assertVersionMatches(dependent, input.expectedVersion, "Dependent");
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        if (input.name !== undefined) data.name = input.name;
        if (input.relationship !== undefined) data.relationship = input.relationship;
        if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth;
        await tx.employeeDependent.update({ where: { id: dependent.id }, data });
        return { id: dependent.id };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/** Soft-delete (archival) — history preserved; audited. */
export async function archiveDependent(
  caller: WorkforceSubject,
  organizationId: string,
  dependentId: string,
  expectedVersion: number,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.dependent.deleted",
        resourceType: "EmployeeDependent",
        resourceId: dependentId,
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const dependent = await tx.employeeDependent.findFirst({
          where: {
            id: dependentId,
            tenantId: caller.tenantId,
            organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true, version: true },
        });
        if (!dependent) notFound("Dependent");
        assertVersionMatches(dependent, expectedVersion, "Dependent");
        return tx.employeeDependent.update({
          where: { id: dependent.id },
          data: { status: "ARCHIVED", updatedBy: caller.userId, version: { increment: 1 } },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listDependents(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<Array<{ id: string; name: string; relationship: string; dateOfBirth: Date | null }>> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    await loadEmployeeInScope(caller, organizationId, employeeId);
    const rows = await prisma.employeeDependent.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, relationship: true, dateOfBirth: true },
    });
    // DOB is SENSITIVE_PERSONAL: only visible through the sensitive grant.
    let canSeeDob = false;
    try {
      await guardSensitiveWrite(caller, organizationId);
      canSeeDob = true;
    } catch {
      canSeeDob = false;
    }
    return rows.map((r) => ({ ...r, dateOfBirth: canSeeDob ? r.dateOfBirth : null }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Credentials ──────────────────────────────────────────────────────────────

export interface CredentialInput {
  organizationId: string;
  employeeId: string;
  type: "LICENSE" | "CERTIFICATION" | "REGISTRATION" | "CLEARANCE";
  name: string;
  issuer: string;
  code?: string | null;
  credentialNumber?: string | null;
  issuedOn?: Date | null;
  expiresOn?: Date | null;
  specialty?: string | null;
  facilityId?: string | null;
}

export async function createCredential(
  caller: WorkforceSubject,
  input: CredentialInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.credential.created",
        resourceType: "EmployeeCredential",
        resourceId: created.id,
        // credentialNumber masked, never raw (plan §7).
        after: { employeeId: input.employeeId, name: input.name, type: input.type },
      }),
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true },
        });
        if (!employee) notFound("Employee");
        if (input.facilityId) {
          const facility = await tx.facility.findFirst({
            where: {
              id: input.facilityId,
              tenantId: caller.tenantId,
              organizationId: input.organizationId,
            },
            select: { id: true },
          });
          if (!facility) {
            throw new WorkforceAppError(
              "RELATIONSHIP_INVALID",
              "Referenced facility does not exist in this organization.",
              "facilityId",
            );
          }
        }
        return tx.employeeCredential.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            type: input.type,
            name: input.name,
            code: input.code ?? null,
            issuer: input.issuer,
            credentialNumber: input.credentialNumber ?? null,
            issuedOn: input.issuedOn ?? null,
            expiresOn: input.expiresOn ?? null,
            specialty: input.specialty ?? null,
            facilityId: input.facilityId ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function updateCredential(
  caller: WorkforceSubject,
  organizationId: string,
  credentialId: string,
  input: {
    name?: string;
    issuer?: string;
    code?: string | null;
    issuedOn?: Date | null;
    expiresOn?: Date | null;
    specialty?: string | null;
    // verificationStatus deliberately ABSENT (Phase 3, ADR-011 §3): the
    // denormalized status changes only via recorded verification acts in
    // the credentials module — never through this metadata edit path.
    expectedVersion: number;
  },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.credential.updated",
        resourceType: "EmployeeCredential",
        resourceId: credentialId,
      },
      async (tx) => {
        const credential = await tx.employeeCredential.findFirst({
          where: {
            id: credentialId,
            tenantId: caller.tenantId,
            organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true, version: true },
        });
        if (!credential) notFound("Credential");
        assertVersionMatches(credential, input.expectedVersion, "Credential");
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        for (const key of [
          "name",
          "issuer",
          "code",
          "issuedOn",
          "expiresOn",
          "specialty",
        ] as const) {
          if (input[key] !== undefined) data[key] = input[key];
        }
        await tx.employeeCredential.update({ where: { id: credential.id }, data });
        return { id: credential.id };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listCredentials(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<
  Array<{
    id: string;
    type: string;
    name: string;
    issuer: string;
    verificationStatus: string;
    expiresOn: Date | null;
    credentialNumberMasked: string | null;
  }>
> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    await loadEmployeeInScope(caller, organizationId, employeeId);
    const rows = await prisma.employeeCredential.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId, status: { not: "ARCHIVED" } },
      orderBy: { expiresOn: "asc" },
      select: {
        id: true,
        type: true,
        name: true,
        issuer: true,
        verificationStatus: true,
        expiresOn: true,
        credentialNumber: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      type: r.type as string,
      verificationStatus: r.verificationStatus as string,
      credentialNumberMasked: r.credentialNumber ? maskCredentialNumber(r.credentialNumber) : null,
    }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

function maskCredentialNumber(no: string): string {
  const digits = no.replace(/\D/g, "");
  const tail = digits.slice(-2) || no.slice(-2);
  return `••••${tail}`;
}

// ── Qualifications ───────────────────────────────────────────────────────────

export interface QualificationInput {
  organizationId: string;
  employeeId: string;
  type: "DEGREE" | "DIPLOMA" | "TRAINING";
  name: string;
  institution?: string | null;
  completedOn?: Date | null;
  registrationNo?: string | null;
}

export async function createQualification(
  caller: WorkforceSubject,
  input: QualificationInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.qualification.created",
        resourceType: "EmployeeQualification",
        resourceId: created.id,
        after: { employeeId: input.employeeId, name: input.name, type: input.type },
      }),
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true },
        });
        if (!employee) notFound("Employee");
        return tx.employeeQualification.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            type: input.type,
            name: input.name,
            institution: input.institution ?? null,
            completedOn: input.completedOn ?? null,
            registrationNo: input.registrationNo ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listQualifications(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<
  Array<{
    id: string;
    type: string;
    name: string;
    institution: string | null;
    completedOn: Date | null;
  }>
> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    await loadEmployeeInScope(caller, organizationId, employeeId);
    const rows = await prisma.employeeQualification.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId, status: { not: "ARCHIVED" } },
      orderBy: { completedOn: "desc" },
      select: { id: true, type: true, name: true, institution: true, completedOn: true },
    });
    return rows.map((r) => ({ ...r, type: r.type as string }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Document references ──────────────────────────────────────────────────────

export interface DocumentReferenceInput {
  organizationId: string;
  employeeId: string;
  docType: string;
  title: string;
  /** Storage id from the future Documents domain (Phase 3) — not a payload. */
  documentRef: string;
  classification?: "PUBLIC" | "INTERNAL" | "PERSONAL" | "SENSITIVE_PERSONAL" | "EMPLOYMENT";
}

export async function createDocumentReference(
  caller: WorkforceSubject,
  input: DocumentReferenceInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.document_ref.created",
        resourceType: "EmployeeDocumentReference",
        resourceId: created.id,
        after: { employeeId: input.employeeId, docType: input.docType, title: input.title },
      }),
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: input.employeeId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true },
        });
        if (!employee) notFound("Employee");
        return tx.employeeDocumentReference.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            docType: input.docType,
            title: input.title,
            documentRef: input.documentRef,
            classification: input.classification ?? "EMPLOYMENT",
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listDocumentReferences(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<
  Array<{
    id: string;
    docType: string;
    title: string;
    documentRef: string;
    classification: string;
    createdAt: Date;
  }>
> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    await loadEmployeeInScope(caller, organizationId, employeeId);
    const rows = await prisma.employeeDocumentReference.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        docType: true,
        title: true,
        documentRef: true,
        classification: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, classification: r.classification as string }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── shared helper ────────────────────────────────────────────────────────────

async function guardSensitiveWrite(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertSensitiveAccess(caller, organizationId);
}

/** Ensure the masked-document rule is enforced for identity documents. */
export function validateIdentityDocumentNumber(numberMasked: string): void {
  assertMaskedDocumentNumber(numberMasked);
}

// Re-export for API-layer type convenience only.
export type { WorkforceSubject };
export type { Tx as WorkforceTransaction };
