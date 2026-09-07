import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting Phase & TaskList Migration...');

    // 1. Get all projects
    const projects = await prisma.project.findMany({
        where: { isDeleted: false },
        select: { id: true, orgId: true },
    });

    console.log(`Found ${projects.length} projects to migrate.`);

    let migratedCount = 0;

    for (const project of projects) {
        const { id: projectId, orgId } = project;

        // Check if phases already exist (idempotency) via raw SQL to avoid enum mismatch
        // when DB still has INTERNAL/CLIENT but schema expects PUBLIC/PRIVATE
        const existing = await prisma.$queryRaw<[{ count: bigint }]>(
            Prisma.sql`SELECT COUNT(*) as count FROM "Phase" WHERE "projectId" = ${projectId} AND name = 'General Phase' AND "isDeleted" = false`,
        );
        const hasPhase = Number(existing[0]?.count ?? 0) > 0;

        if (hasPhase) {
            console.log(`Skipping project ${projectId} (Already migrated)`);
            continue;
        }

        // 2. Create "General" phase
        const phase = await prisma.phase.create({
            data: {
                orgId,
                projectId,
                name: 'General Phase',
                orderIndex: 0,
                access: 'PRIVATE',
            },
        });

        // 3. Create "Default Task List"
        const taskList = await prisma.taskList.create({
            data: {
                orgId,
                projectId,
                phaseId: phase.id,
                name: 'Default Task List',
                orderIndex: 0,
                access: 'PRIVATE',
            },
        });

        // 4. Update existing tasks
        // Only update tasks that don't have a taskListId yet
        const updateResult = await prisma.task.updateMany({
            where: {
                projectId,
                taskListId: null,
                isDeleted: false,
            },
            data: {
                phaseId: phase.id,
                taskListId: taskList.id,
            },
        });

        console.log(`Migrated project ${projectId}: Created Phase/TaskList, Updated ${updateResult.count} tasks.`);
        migratedCount++;
    }

    console.log(`✅ Migration complete. Migrated ${migratedCount} projects.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
