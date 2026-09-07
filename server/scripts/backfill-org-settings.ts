import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Creates default OrgSettings rows for organizations that don't have one.
 * Safe to run multiple times (idempotent).
 */
async function main() {
  console.log('Backfilling OrgSettings for existing organizations...');

  const orgsWithSettings = await prisma.orgSettings.findMany({
    select: { orgId: true },
  });
  const orgIdsWithSettings = new Set(orgsWithSettings.map((s) => s.orgId));

  const allOrgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  const orgsWithoutSettings = allOrgs.filter((org) => !orgIdsWithSettings.has(org.id));

  if (orgsWithoutSettings.length === 0) {
    console.log('All organizations already have settings. Nothing to do.');
    return;
  }

  console.log(`Found ${orgsWithoutSettings.length} organization(s) without settings.`);

  let created = 0;
  for (const org of orgsWithoutSettings) {
    await prisma.orgSettings.create({
      data: { orgId: org.id },
    });
    console.log(`  Created settings for org: ${org.name} (${org.id})`);
    created++;
  }

  console.log(`Done. Created ${created} OrgSettings row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
