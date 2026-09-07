import { PrismaClient, TaskType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Task ID Backfill Migration...');

  // 1. Get all active projects
  const projects = await prisma.project.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
  });

  console.log(`Found ${projects.length} projects to process.`);

  let totalTasksUpdated = 0;

  for (const project of projects) {
    const { id: projectId, name: projectName } = project;
    const prefix = projectName.substring(0, 3).toUpperCase();

    // 2. We'll handle tasks grouped by their type
    // If type is null, we'll assign 'FEAT' as a default for migration purposes
    // since the taskId format depends on type.
    
    const typesToProcess = [...Object.values(TaskType), null];

    for (const type of typesToProcess) {
      // Find tasks of this type in this project that don't have a taskId
      const tasks = await prisma.task.findMany({
        where: {
          projectId,
          type: type as (TaskType | null),
          taskId: null,
          isDeleted: false,
        },
        orderBy: { createdAt: 'asc' }, // Order by creation time to assign sensible sequence
      });

      if (tasks.length === 0) continue;

      console.log(`  Processing ${tasks.length} tasks of type ${type || 'NULL (setting to FEAT)'} for project "${projectName}"...`);

      // Determine where the sequence should start
      // Check if there are already tasks with taskId for this type (to avoid overlapping)
      const existingCount = await prisma.task.count({
        where: {
          projectId,
          type: (type || 'FEAT') as TaskType,
          taskId: { not: null },
        },
      });

      let sequence = existingCount + 1;

      // Update tasks one by one to ensure unique taskIds (cannot easily do taskId in updateMany with increments)
      for (const task of tasks) {
        const finalType = (type || 'FEAT') as TaskType;
        const formattedSequence = sequence.toString().padStart(5, '0');
        const taskIdStr = `${prefix}-${finalType}-${formattedSequence}`;

        await prisma.task.update({
          where: { id: task.id },
          data: {
            type: finalType,
            taskId: taskIdStr,
          },
        });

        sequence++;
        totalTasksUpdated++;
      }
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total Tasks Updated: ${totalTasksUpdated}`);
  console.log('------------------------');
  console.log('✅ Backfill complete.');
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
