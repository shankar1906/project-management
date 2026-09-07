/*
  Warnings:

  - The primary key for the `OrgSettings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `OrgSettings` table. All the data in the column will be lost.
  - You are about to drop the column `maxMembers` on the `OrgSettings` table. All the data in the column will be lost.
  - You are about to drop the column `maxProjects` on the `OrgSettings` table. All the data in the column will be lost.
  - You are about to drop the column `planType` on the `OrgSettings` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UserPresenceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'LUNCH', 'BREAK', 'WFH', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'WFH', 'REMOTE');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('LUNCH', 'BREAK');

-- CreateEnum
CREATE TYPE "TimeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('FEAT', 'BUG', 'IMPR', 'REF', 'RND', 'DOC', 'OPS', 'TEST', 'HOT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectStatus" ADD VALUE 'PLANNING';
ALTER TYPE "ProjectStatus" ADD VALUE 'REVIEW';
ALTER TYPE "ProjectStatus" ADD VALUE 'TESTING';
ALTER TYPE "ProjectStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "ProjectStatus" ADD VALUE 'ARCHIVED';

-- DropForeignKey
ALTER TABLE "OrgSettings" DROP CONSTRAINT "OrgSettings_orgId_fkey";

-- DropIndex
DROP INDEX "OrgSettings_orgId_key";

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "lastAccessedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrgSettings" DROP CONSTRAINT "OrgSettings_pkey",
DROP COLUMN "id",
DROP COLUMN "maxMembers",
DROP COLUMN "maxProjects",
DROP COLUMN "planType",
ALTER COLUMN "updatedAt" DROP DEFAULT,
ADD CONSTRAINT "OrgSettings_pkey" PRIMARY KEY ("orgId");

-- AlterTable
ALTER TABLE "Phase" ADD COLUMN     "completionPercentage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completionPercentage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "taskId" TEXT,
ADD COLUMN     "type" "TaskType";

-- CreateTable
CREATE TABLE "PhaseTag" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "PhaseTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseAssignee" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PhaseAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskListTag" (
    "id" TEXT NOT NULL,
    "taskListId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TaskListTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenceStatus" (
    "userId" TEXT NOT NULL,
    "status" "UserPresenceStatus" NOT NULL,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceStatus_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "workMode" "WorkMode" NOT NULL,
    "totalMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "BreakType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),

    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveTimer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "phaseId" TEXT,
    "taskListId" TEXT,
    "taskId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "taskListId" TEXT,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "status" "TimeStatus" NOT NULL DEFAULT 'DRAFT',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "hourlyRateSnapshot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyTimesheet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "TimeStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "WeeklyTimesheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhaseTag_phaseId_idx" ON "PhaseTag"("phaseId");

-- CreateIndex
CREATE INDEX "PhaseTag_tagId_idx" ON "PhaseTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseTag_phaseId_tagId_key" ON "PhaseTag"("phaseId", "tagId");

-- CreateIndex
CREATE INDEX "PhaseAssignee_phaseId_idx" ON "PhaseAssignee"("phaseId");

-- CreateIndex
CREATE INDEX "PhaseAssignee_userId_idx" ON "PhaseAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseAssignee_phaseId_userId_key" ON "PhaseAssignee"("phaseId", "userId");

-- CreateIndex
CREATE INDEX "TaskListTag_taskListId_idx" ON "TaskListTag"("taskListId");

-- CreateIndex
CREATE INDEX "TaskListTag_tagId_idx" ON "TaskListTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskListTag_taskListId_tagId_key" ON "TaskListTag"("taskListId", "tagId");

-- CreateIndex
CREATE INDEX "AttendanceSession_userId_idx" ON "AttendanceSession"("userId");

-- CreateIndex
CREATE INDEX "AttendanceSession_orgId_idx" ON "AttendanceSession"("orgId");

-- CreateIndex
CREATE INDEX "AttendanceBreak_sessionId_idx" ON "AttendanceBreak"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveTimer_userId_key" ON "ActiveTimer"("userId");

-- CreateIndex
CREATE INDEX "ActiveTimer_orgId_idx" ON "ActiveTimer"("orgId");

-- CreateIndex
CREATE INDEX "ActiveTimer_taskId_idx" ON "ActiveTimer"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_orgId_idx" ON "TimeEntry"("orgId");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_phaseId_idx" ON "TimeEntry"("phaseId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskListId_idx" ON "TimeEntry"("taskListId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_idx" ON "TimeEntry"("userId");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- CreateIndex
CREATE INDEX "WeeklyTimesheet_orgId_idx" ON "WeeklyTimesheet"("orgId");

-- CreateIndex
CREATE INDEX "WeeklyTimesheet_userId_idx" ON "WeeklyTimesheet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyTimesheet_orgId_userId_weekStart_key" ON "WeeklyTimesheet"("orgId", "userId", "weekStart");

-- CreateIndex
CREATE INDEX "Task_taskId_idx" ON "Task"("taskId");

-- CreateIndex
CREATE INDEX "Task_type_idx" ON "Task"("type");

-- AddForeignKey
ALTER TABLE "PhaseTag" ADD CONSTRAINT "PhaseTag_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTag" ADD CONSTRAINT "PhaseTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseAssignee" ADD CONSTRAINT "PhaseAssignee_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseAssignee" ADD CONSTRAINT "PhaseAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskListTag" ADD CONSTRAINT "TaskListTag_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskListTag" ADD CONSTRAINT "TaskListTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceStatus" ADD CONSTRAINT "PresenceStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
