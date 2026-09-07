import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const orgId = 'cmkcdw4zv0003y1vthrft1eyi';
    console.log(`Checking Org: ${orgId}`);

    const projects = await prisma.project.findMany({
        where: { orgId }
    });
    console.log('Projects found:', projects.length);
    projects.forEach(p => console.log(`- ${p.name} (Deleted: ${p.isDeleted})`));

    const userId = 'cmkcgxhru000zzivdse02vwcc';
    const member = await prisma.orgMember.findUnique({
        where: { userId_orgId: { userId, orgId } }
    });
    console.log('Membership status:', member);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
