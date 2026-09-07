/**
 * RBAC + Multi-Tenant Integration Tests (E2E)
 *
 * Run with: pnpm test -- test/rbac.e2e-spec.ts
 * Requires test DB and seed (or set E2E_RBAC_* env vars).
 *
 * Mandatory scenarios (checklist):
 * 1. Org MEMBER tries to create project → 403
 * 2. PROJECT_VIEWER tries to create task → 403
 * 3. PROJECT_MEMBER tries to delete task → 403
 * 4. Cross-project taskList injection → 403
 * 5. Access project from different org header → 403 (strict model)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const E2E_ENABLED = process.env.E2E_RBAC_ENABLED === '1';
const skipE2E = !E2E_ENABLED;

describe('RBAC E2E (integration)', () => {
  let app: INestApplication;
  let _prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    _prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('1. Org MEMBER tries to create project → 403', () => {
    it('returns 403 when org role is MEMBER', async () => {
      if (skipE2E) return;
      // Requires: memberToken (JWT for user with OrgRole MEMBER), orgId
      const memberToken = process.env.E2E_RBAC_MEMBER_TOKEN;
      const orgId = process.env.E2E_RBAC_ORG_ID;
      if (!memberToken || !orgId) {
        console.warn('Skip: set E2E_RBAC_MEMBER_TOKEN and E2E_RBAC_ORG_ID');
        return;
      }
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({ name: 'Test Project' });
      expect(res.status).toBe(403);
    });
  });

  describe('2. PROJECT_VIEWER tries to create task → 403', () => {
    it('returns 403 when project role is VIEWER', async () => {
      if (skipE2E) return;
      const viewerToken = process.env.E2E_RBAC_VIEWER_TOKEN;
      const orgId = process.env.E2E_RBAC_ORG_ID;
      const projectId = process.env.E2E_RBAC_PROJECT_ID;
      if (!viewerToken || !orgId || !projectId) {
        console.warn('Skip: set E2E_RBAC_VIEWER_TOKEN, E2E_RBAC_ORG_ID, E2E_RBAC_PROJECT_ID');
        return;
      }
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-org-id', orgId)
        .send({ title: 'Test Task' });
      expect(res.status).toBe(403);
    });
  });

  describe('3. PROJECT_MEMBER tries to delete task → 403', () => {
    it('returns 403 when project role is MEMBER (only ADMIN can delete)', async () => {
      if (skipE2E) return;
      const memberToken = process.env.E2E_RBAC_PROJECT_MEMBER_TOKEN;
      const orgId = process.env.E2E_RBAC_ORG_ID;
      const taskId = process.env.E2E_RBAC_TASK_ID;
      if (!memberToken || !orgId || !taskId) {
        console.warn('Skip: set E2E_RBAC_PROJECT_MEMBER_TOKEN, E2E_RBAC_ORG_ID, E2E_RBAC_TASK_ID');
        return;
      }
      const res = await request(app.getHttpServer())
        .delete(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Cross-project taskList injection → 403', () => {
    it('returns 403 when taskListId belongs to another project', async () => {
      if (skipE2E) return;
      const token = process.env.E2E_RBAC_MEMBER_TOKEN;
      const orgId = process.env.E2E_RBAC_ORG_ID;
      const projectId = process.env.E2E_RBAC_PROJECT_ID;
      const otherProjectTaskListId = process.env.E2E_RBAC_OTHER_PROJECT_TASKLIST_ID;
      if (!token || !orgId || !projectId || !otherProjectTaskListId) {
        console.warn('Skip: set E2E_RBAC_* for cross-project taskList');
        return;
      }
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Injected Task',
          taskListId: otherProjectTaskListId,
        });
      expect(res.status).toBe(403);
    });
  });

  describe('5. Access project from different org header → 403 (strict isolation)', () => {
    it('returns 403 when x-org-id does not match project org', async () => {
      if (skipE2E) return;
      const token = process.env.E2E_RBAC_ADMIN_TOKEN;
      const projectInOrgA = process.env.E2E_RBAC_PROJECT_IN_ORG_A;
      const orgB = process.env.E2E_RBAC_ORG_B_ID;
      if (!token || !projectInOrgA || !orgB) {
        console.warn('Skip: set E2E_RBAC_ADMIN_TOKEN, E2E_RBAC_PROJECT_IN_ORG_A, E2E_RBAC_ORG_B_ID');
        return;
      }
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectInOrgA}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgB);
      expect(res.status).toBe(403);
    });
  });
});
