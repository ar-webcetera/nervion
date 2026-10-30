import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonitorJobRetention1793500001000 implements MigrationInterface {
  name = 'MonitorJobRetention1793500001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX tenant_monitor_jobs_completed
      ON public.tenant_jobs (tenant_id, completed_at)
      WHERE kind = 'healthchecks.probe' AND status = 'completed'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX public.tenant_monitor_jobs_completed');
  }
}
