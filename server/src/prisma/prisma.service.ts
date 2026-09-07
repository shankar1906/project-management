import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit() {
    // ── Auto-migrate on startup (controlled by DB_MIGRATE env var) ──────────
    // Set DB_MIGRATE=true in .env to run migrations on startup.
    // Use DB_MIGRATE=false in production to skip (migrations should be pre-run).
    if (process.env.DB_MIGRATE === 'true') {
      await this.runMigrations();
    }

    // ── Connect to database ─────────────────────────────────────────────────
    try {
      await this.$connect();
      this.logger.log('✅ Database connected successfully');
    } catch (error) {
      this.logger.error('❌ Database connection failed', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Runs `prisma migrate deploy` safely on startup.
   * - Uses DEPLOY mode (no shadow DB, no prompts, safe for all environments)
   * - Skips if no pending migrations
   * - Logs clearly on success or failure
   * - Does NOT crash the app if already up-to-date
   */
  private async runMigrations(): Promise<void> {
    this.logger.log('🔄 DB_MIGRATE=true — Running pending migrations...');

    try {
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: process.env,
      });
      this.logger.log('✅ Migrations applied successfully (or already up-to-date)');
    } catch (error: any) {
      this.logger.error('❌ Migration failed on startup!');
      this.logger.error(
        'Fix: Run "npm run db:status" to check migration state',
      );
      this.logger.error(
        'Fix: Run "npm run prisma:resolve:applied <migration_name>" if migration was applied manually',
      );
      // Re-throw so the app boots ONLY if migration succeeds.
      // This prevents running a stale schema in production.
      throw new Error(`Prisma migration failed: ${error.message}`);
    }
  }

  /**
   * Clean shutdown - disconnect from database
   */
  async enableShutdownHooks() {
    process.on('SIGTERM', async () => {
      this.logger.log('SIGTERM received, closing database connection');
      await this.$disconnect();
    });

    process.on('SIGINT', async () => {
      this.logger.log('SIGINT received, closing database connection');
      await this.$disconnect();
    });
  }
}
