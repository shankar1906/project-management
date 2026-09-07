/*
  Warnings:

  - A unique constraint covering the columns `[orgId,projectId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `projectId` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "projectId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_projectId_key" ON "Project"("orgId", "projectId");
