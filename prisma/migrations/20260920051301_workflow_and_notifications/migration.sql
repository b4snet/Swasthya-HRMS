-- CreateEnum
CREATE TYPE "WorkflowSourceType" AS ENUM ('EMPLOYEE', 'POSITION', 'CONTRACT', 'CREDENTIAL', 'LEAVE_REQUEST', 'ONBOARDING', 'SEPARATION', 'TRANSFER', 'PROMOTION');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('REQUESTED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "taskType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkflowTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'PENDING',
    "assigneeUserId" TEXT,
    "sourceType" "WorkflowSourceType",
    "sourceId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "requestType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "rationale" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requesterUserId" TEXT,
    "approverUserId" TEXT,
    "approverName" TEXT,
    "sourceType" "WorkflowSourceType",
    "sourceId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "href" TEXT,
    "entityType" "WorkflowSourceType",
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_tasks_tenantId_status_idx" ON "workflow_tasks"("tenantId", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_assigneeUserId_status_idx" ON "workflow_tasks"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_sourceType_sourceId_idx" ON "workflow_tasks"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_status_idx" ON "approval_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_approverUserId_status_idx" ON "approval_requests"("approverUserId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_sourceType_sourceId_idx" ON "approval_requests"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "app_notifications_recipientUserId_readAt_idx" ON "app_notifications"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "app_notifications_recipientUserId_createdAt_idx" ON "app_notifications"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "app_notifications_tenantId_notificationType_idx" ON "app_notifications"("tenantId", "notificationType");

-- CreateIndex
CREATE INDEX "app_notifications_entityType_entityId_idx" ON "app_notifications"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
