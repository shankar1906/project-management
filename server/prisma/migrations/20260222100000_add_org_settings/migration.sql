-- CreateTable
CREATE TABLE "OrgSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requireAttendance" BOOLEAN NOT NULL DEFAULT false,
    "requireCheckInForTimer" BOOLEAN NOT NULL DEFAULT false,
    "allowManualTimeEntry" BOOLEAN NOT NULL DEFAULT true,
    "allowMultipleTimers" BOOLEAN NOT NULL DEFAULT false,
    "requireTimesheetApproval" BOOLEAN NOT NULL DEFAULT true,
    "enableUserPresence" BOOLEAN NOT NULL DEFAULT true,
    "enforceProjectRoleStrict" BOOLEAN NOT NULL DEFAULT true,
    "lockTimesheetAfterApproval" BOOLEAN NOT NULL DEFAULT true,
    "autoSubmitTimesheet" BOOLEAN NOT NULL DEFAULT false,
    "planType" TEXT DEFAULT 'FREE',
    "maxProjects" INTEGER,
    "maxMembers" INTEGER,

    CONSTRAINT "OrgSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSettings_orgId_key" ON "OrgSettings"("orgId");

-- CreateIndex
CREATE INDEX "OrgSettings_orgId_idx" ON "OrgSettings"("orgId");

-- AddForeignKey
ALTER TABLE "OrgSettings" ADD CONSTRAINT "OrgSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
