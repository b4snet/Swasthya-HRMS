-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('EMPLOYMENT', 'SECONDMENT', 'NDA', 'CONFIDENTIALITY', 'LOCUM', 'CONSULTANCY', 'INTERNSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractPartyType" AS ENUM ('EMPLOYEE', 'EMPLOYER_ORGANIZATION', 'WITNESS', 'GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentSubjectType" AS ENUM ('EMPLOYEE', 'PERSON', 'EMPLOYMENT', 'CONTRACT', 'CREDENTIAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "AuthorityType" AS ENUM ('MEDICAL_COUNCIL', 'NURSING_COUNCIL', 'GOVERNMENT', 'UNIVERSITY', 'BOARD', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('ISSUER_DIRECT', 'PORTAL', 'DOCUMENT_INSPECTION', 'PHONE', 'OTHER');

-- AlterTable
ALTER TABLE "employee_credentials" ADD COLUMN     "issuingAuthorityId" TEXT,
ADD COLUMN     "jurisdiction" TEXT,
ADD COLUMN     "verificationRecordId" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT;

-- AlterTable
ALTER TABLE "employee_document_references" ADD COLUMN     "documentId" TEXT;

-- AlterTable
ALTER TABLE "employee_qualifications" ADD COLUMN     "awardingBody" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "fieldOfStudy" TEXT,
ADD COLUMN     "issuingAuthorityId" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT;

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "description" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_template_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "note" TEXT,
    "bodyDocumentId" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "contract_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersionNo" INTEGER,
    "title" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "jurisdiction" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "signedOn" TIMESTAMP(3),
    "signedByEmployee" TEXT,
    "signedByEmployer" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "clauseNames" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_parties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "partyType" "ContractPartyType" NOT NULL,
    "personId" TEXT,
    "organizationId" TEXT,
    "freeTextName" TEXT,
    "role" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "contract_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultClassification" "DataClassification" NOT NULL DEFAULT 'EMPLOYMENT',
    "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER,
    "description" TEXT,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "subjectType" "DocumentSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'EMPLOYMENT',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "storageId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "note" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "granteeType" TEXT NOT NULL,
    "granteeValue" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canDownload" BOOLEAN NOT NULL DEFAULT true,
    "grantedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuing_authorities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorityType" "AuthorityType" NOT NULL,
    "jurisdiction" TEXT,
    "website" TEXT,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "issuing_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_type_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT true,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT true,
    "defaultValidityMonths" INTEGER,
    "renewalLeadDays" INTEGER NOT NULL DEFAULT 60,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "credential_type_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_verification_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceDocumentId" TEXT,
    "notes" TEXT,
    "reverifyDue" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "credential_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_renewals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "priorCredentialId" TEXT,
    "newExpiresOn" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "credential_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_verification_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceDocumentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "qualification_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_templates_status_idx" ON "contract_templates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_tenantId_code_key" ON "contract_templates"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "contract_template_versions_templateId_versionNo_key" ON "contract_template_versions"("templateId", "versionNo");

-- CreateIndex
CREATE INDEX "contracts_organizationId_idx" ON "contracts"("organizationId");

-- CreateIndex
CREATE INDEX "contracts_employmentId_idx" ON "contracts"("employmentId");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_effectiveTo_idx" ON "contracts"("effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenantId_organizationId_contractNo_key" ON "contracts"("tenantId", "organizationId", "contractNo");

-- CreateIndex
CREATE INDEX "contract_versions_contractId_idx" ON "contract_versions"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contractId_versionNo_key" ON "contract_versions"("contractId", "versionNo");

-- CreateIndex
CREATE INDEX "contract_parties_contractId_idx" ON "contract_parties"("contractId");

-- CreateIndex
CREATE INDEX "document_types_status_idx" ON "document_types"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_tenantId_code_key" ON "document_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "documents_organizationId_idx" ON "documents"("organizationId");

-- CreateIndex
CREATE INDEX "documents_subjectType_subjectId_idx" ON "documents"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "documents_typeId_idx" ON "documents"("typeId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_effectiveTo_idx" ON "documents"("effectiveTo");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE INDEX "document_versions_storageId_idx" ON "document_versions"("storageId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNo_key" ON "document_versions"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "document_access_grants_documentId_idx" ON "document_access_grants"("documentId");

-- CreateIndex
CREATE INDEX "document_access_grants_granteeType_granteeValue_idx" ON "document_access_grants"("granteeType", "granteeValue");

-- CreateIndex
CREATE INDEX "issuing_authorities_status_idx" ON "issuing_authorities"("status");

-- CreateIndex
CREATE UNIQUE INDEX "issuing_authorities_tenantId_code_key" ON "issuing_authorities"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "credential_type_configs_tenantId_code_key" ON "credential_type_configs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "credential_verification_records_credentialId_idx" ON "credential_verification_records"("credentialId");

-- CreateIndex
CREATE INDEX "credential_verification_records_outcome_idx" ON "credential_verification_records"("outcome");

-- CreateIndex
CREATE INDEX "credential_renewals_credentialId_idx" ON "credential_renewals"("credentialId");

-- CreateIndex
CREATE INDEX "qualification_verification_records_qualificationId_idx" ON "qualification_verification_records"("qualificationId");

-- CreateIndex
CREATE INDEX "qualification_verification_records_outcome_idx" ON "qualification_verification_records"("outcome");

-- CreateIndex
CREATE INDEX "employee_credentials_issuingAuthorityId_idx" ON "employee_credentials"("issuingAuthorityId");

-- CreateIndex
CREATE INDEX "employee_credentials_issuer_idx" ON "employee_credentials"("issuer");

-- AddForeignKey
ALTER TABLE "employee_credentials" ADD CONSTRAINT "employee_credentials_issuingAuthorityId_fkey" FOREIGN KEY ("issuingAuthorityId") REFERENCES "issuing_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_issuingAuthorityId_fkey" FOREIGN KEY ("issuingAuthorityId") REFERENCES "issuing_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_references" ADD CONSTRAINT "employee_document_references_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_bodyDocumentId_fkey" FOREIGN KEY ("bodyDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuing_authorities" ADD CONSTRAINT "issuing_authorities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_type_configs" ADD CONSTRAINT "credential_type_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_verification_records" ADD CONSTRAINT "credential_verification_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_verification_records" ADD CONSTRAINT "credential_verification_records_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "employee_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_verification_records" ADD CONSTRAINT "credential_verification_records_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_renewals" ADD CONSTRAINT "credential_renewals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_renewals" ADD CONSTRAINT "credential_renewals_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "employee_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_verification_records" ADD CONSTRAINT "qualification_verification_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_verification_records" ADD CONSTRAINT "qualification_verification_records_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "employee_qualifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_verification_records" ADD CONSTRAINT "qualification_verification_records_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial unique index (hand-written; Prisma cannot express partial unique
-- constraints). Exactly ONE ACTIVE contract per (employment, type): signing
-- a second employment contract for the same employment is a domain error,
-- not an accident. Mirrors `assignments_open_per_employment_key` (Phase 2)
-- and `reporting_edges_active_pair_type_key` (Phase 1).
CREATE UNIQUE INDEX "contracts_active_per_employment_type_key"
  ON "contracts"("employmentId", "type")
  WHERE "status" = 'ACTIVE';

-- Phase 3 amendment (same migration, pre-release): IN_PROGRESS joins the
-- CredentialVerificationStatus enum for real verification turnarounds
-- (ADR-011 §3). EXPIRED stays DERIVED (never manually written).
ALTER TYPE "CredentialVerificationStatus" ADD VALUE 'IN_PROGRESS';

-- Phase 3 amendment (same migration, pre-release): REJECTED joins the stored
-- CredentialVerificationStatus set so the denormalized status can mirror the
-- record outcome (PENDING/IN_PROGRESS/VERIFIED/REJECTED/EXPIRED/REVOKED)
-- without a second state vocabulary. EXPIRED remains derived-only.
ALTER TYPE "CredentialVerificationStatus" ADD VALUE 'REJECTED';

-- Phase 3 prompt-3 amendment (same migration, pre-release): SUSPENDED joins
-- VerificationOutcome + CredentialVerificationStatus. Suspend is a reversible
-- administrative hold distinct from REVOKED (which is terminal); both remain
-- explicit recorded acts — never free-field writes.
ALTER TYPE "CredentialVerificationStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "VerificationOutcome" ADD VALUE 'SUSPENDED';
