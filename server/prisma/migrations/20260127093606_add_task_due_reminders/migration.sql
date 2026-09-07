-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('BEFORE_3_DAYS', 'BEFORE_2_DAYS', 'BEFORE_24_HOURS', 'ON_DUE_DATE', 'OVERDUE');

-- CreateTable
CREATE TABLE "TaskDueReminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "reminderType" "ReminderType" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDueReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDueReminder_taskId_idx" ON "TaskDueReminder"("taskId");

-- CreateIndex
CREATE INDEX "TaskDueReminder_reminderType_idx" ON "TaskDueReminder"("reminderType");

-- CreateIndex
CREATE INDEX "TaskDueReminder_sentAt_idx" ON "TaskDueReminder"("sentAt");

-- CreateIndex
CREATE INDEX "TaskDueReminder_createdAt_idx" ON "TaskDueReminder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDueReminder_taskId_reminderType_key" ON "TaskDueReminder"("taskId", "reminderType");

-- AddForeignKey
ALTER TABLE "TaskDueReminder" ADD CONSTRAINT "TaskDueReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
