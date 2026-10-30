import { EntityManager } from 'typeorm';

/** Runs inside the tenant transaction. Safe after a partial provisioning retry. */
export async function seedTenantDefaults(manager: EntityManager, tenantId: string): Promise<void> {
  await manager.query(
    `
    INSERT INTO task_stages (tenant_id, id, title, position, protected) VALUES
      ($1, 'archive', 'Архив', 0, false), ($1, 'open', 'Открыто', 1, true),
      ($1, 'to_do', 'К выполнению', 2, false), ($1, 'in_progress', 'Выполняется', 3, true),
      ($1, 'waiting', 'Ожидание', 4, false), ($1, 'in_review', 'На ревью', 5, false),
      ($1, 'control', 'Контроль', 6, false), ($1, 'closed', 'Закрыто', 7, true)
    ON CONFLICT (tenant_id, id) DO NOTHING
  `,
    [tenantId],
  );
  await manager.query(
    `
    INSERT INTO crm_stages (tenant_id, name, position, kind) VALUES
      ($1, 'Новая заявка', 1, 'open'), ($1, 'Квалификация', 2, 'open'),
      ($1, 'Обсуждение задачи', 3, 'open'), ($1, 'Предложение отправлено', 4, 'open'),
      ($1, 'Переговоры', 5, 'open'), ($1, 'Договор / оплата', 6, 'open'),
      ($1, 'Успешно', 7, 'won'), ($1, 'Проиграно', 8, 'lost')
    ON CONFLICT (tenant_id, position) DO NOTHING
  `,
    [tenantId],
  );
}
