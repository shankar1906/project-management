import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Phase & TaskList Migration to Hierarchical Structure...');

  // 1. Get all active projects
  const projects = await prisma.project.findMany({
    where: { isDeleted: false },
    select: { id: true, orgId: true, name: true },
  });

  console.log(`Found ${projects.length} projects to process.`);

  let projectsMigrated = 0;
  let totalPhasesCreated = 0;
  let totalTaskListsCreated = 0;
  let totalTasksUpdated = 0;

  for (const project of projects) {
    const { id: projectId, orgId, name: projectName } = project;

    // Check if phases already exist for this project
    const existingPhases = await prisma.phase.findMany({
      where: { projectId, isDeleted: false },
      orderBy: { orderIndex: 'asc' },
    });

    if (existingPhases.length > 0) {
      console.log(`Project "${projectName}" (${projectId}) already has phases. Checking for tasks to migrate...`);
      
      // Even if phases exist, there might be tasks floating without a tasklist
      // we'll optionally migrate them to the first tasklist of the first phase if any exist
      const floatingTasksCount = await prisma.task.count({
        where: { projectId, taskListId: null, isDeleted: false },
      });

      if (floatingTasksCount > 0) {
        // Find the first tasklist of the first phase
        const firstPhase = existingPhases[0];
        const firstTaskList = await prisma.taskList.findFirst({
          where: { phaseId: firstPhase.id, isDeleted: false },
          orderBy: { orderIndex: 'asc' },
        });

        if (firstTaskList) {
          const updateResult = await prisma.task.updateMany({
            where: { projectId, taskListId: null, isDeleted: false },
            data: {
              phaseId: firstPhase.id,
              taskListId: firstTaskList.id,
            },
          });
          console.log(`  Updated ${updateResult.count} floating tasks to "${firstPhase.name}" -> "${firstTaskList.name}"`);
          totalTasksUpdated += updateResult.count;
        } else {
          // If first phase has no tasklist, create one
          const newTaskList = await prisma.taskList.create({
            data: {
              orgId,
              projectId,
              phaseId: firstPhase.id,
              name: 'Tasklist 1',
              orderIndex: 0,
              access: 'PRIVATE',
            },
          });
          const updateResult = await prisma.task.updateMany({
            where: { projectId, taskListId: null, isDeleted: false },
            data: {
              phaseId: firstPhase.id,
              taskListId: newTaskList.id,
            },
          });
          console.log(`  Created "Tasklist 1" in "${firstPhase.name}" and updated ${updateResult.count} tasks.`);
          totalTaskListsCreated++;
          totalTasksUpdated += updateResult.count;
        }
      }
      continue;
    }

    console.log(`Migrating Project "${projectName}" (${projectId})...`);

    // 2. Create Default Phases (Phase 1, Phase 2)
    const phase1 = await prisma.phase.create({
      data: {
        orgId,
        projectId,
        name: 'Phase 1',
        orderIndex: 0,
        access: 'PRIVATE',
        status: 'NOT_STARTED',
      },
    });

    const phase2 = await prisma.phase.create({
      data: {
        orgId,
        projectId,
        name: 'Phase 2',
        orderIndex: 1,
        access: 'PRIVATE',
        status: 'NOT_STARTED',
      },
    });

    totalPhasesCreated += 2;

    // 3. Create Default TaskLists for each Phase
    // For Phase 1
    const phase1TaskList1 = await prisma.taskList.create({
      data: {
        orgId,
        projectId,
        phaseId: phase1.id,
        name: 'Tasklist 1',
        orderIndex: 0,
        access: 'PRIVATE',
      },
    });

    await prisma.taskList.create({
      data: {
        orgId,
        projectId,
        phaseId: phase1.id,
        name: 'Tasklist 2',
        orderIndex: 1,
        access: 'PRIVATE',
      },
    });

    // For Phase 2
    await prisma.taskList.create({
      data: {
        orgId,
        projectId,
        phaseId: phase2.id,
        name: 'Tasklist 1',
        orderIndex: 0,
        access: 'PRIVATE',
      },
    });

    await prisma.taskList.create({
      data: {
        orgId,
        projectId,
        phaseId: phase2.id,
        name: 'Tasklist 2',
        orderIndex: 1,
        access: 'PRIVATE',
      },
    });

    totalTaskListsCreated += 4;

    // 4. Update existing tasks to point to Phase 1 -> Tasklist 1
    const updateResult = await prisma.task.updateMany({
      where: {
        projectId,
        taskListId: null,
        isDeleted: false,
      },
      data: {
        phaseId: phase1.id,
        taskListId: phase1TaskList1.id,
      },
    });

    console.log(`  Created Phase 1/2 and Tasklist 1/2. Updated ${updateResult.count} tasks.`);
    totalTasksUpdated += updateResult.count;
    projectsMigrated++;
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Projects Migrated: ${projectsMigrated}`);
  console.log(`Phases Created:    ${totalPhasesCreated}`);
  console.log(`TaskLists Created: ${totalTaskListsCreated}`);
  console.log(`Tasks Updated:     ${totalTasksUpdated}`);
  console.log('------------------------');
  console.log('✅ Migration complete.');
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
