import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddCrm1790500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm_companies (id serial PRIMARY KEY, name varchar(200) NOT NULL, legal_name varchar NOT NULL DEFAULT '', inn varchar NOT NULL DEFAULT '', website varchar NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', responsible_id int REFERENCES users(id) ON DELETE SET NULL);
      CREATE TABLE crm_contacts (id serial PRIMARY KEY, name varchar(200) NOT NULL, company_id int REFERENCES crm_companies(id) ON DELETE SET NULL, position varchar NOT NULL DEFAULT '', phone varchar NOT NULL DEFAULT '', email varchar NOT NULL DEFAULT '', telegram varchar NOT NULL DEFAULT '');
      CREATE TABLE crm_stages (id serial PRIMARY KEY, name varchar NOT NULL, position int NOT NULL UNIQUE, kind varchar NOT NULL CHECK(kind IN ('open','won','lost')));
      INSERT INTO crm_stages(name,position,kind) VALUES ('Новая заявка',1,'open'),('Квалификация',2,'open'),('Обсуждение задачи',3,'open'),('Предложение отправлено',4,'open'),('Переговоры',5,'open'),('Договор / оплата',6,'open'),('Успешно',7,'won'),('Проиграно',8,'lost');
      CREATE TABLE crm_deals (id serial PRIMARY KEY, title varchar(200) NOT NULL, stage_id int NOT NULL REFERENCES crm_stages(id), amount numeric(12,2) CHECK(amount >= 0), company_id int REFERENCES crm_companies(id) ON DELETE SET NULL, contact_ids int[] NOT NULL DEFAULT '{}', primary_contact_id int REFERENCES crm_contacts(id) ON DELETE SET NULL, responsible_id int REFERENCES users(id) ON DELETE SET NULL, source varchar NOT NULL DEFAULT '', expected_close date, project_id int REFERENCES projects(id) ON DELETE SET NULL, description jsonb, loss_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX crm_deals_stage_idx ON crm_deals(stage_id, updated_at DESC, id DESC);
      CREATE INDEX crm_deals_company_idx ON crm_deals(company_id);
      CREATE TABLE crm_activities (id serial PRIMARY KEY, deal_id int NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE, kind varchar NOT NULL, message jsonb, summary text NOT NULL DEFAULT '', author_name varchar NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX crm_activities_deal_idx ON crm_activities(deal_id, created_at);
      ALTER TABLE tasks ADD COLUMN business_kind varchar NOT NULL DEFAULT 'production' CHECK(business_kind IN ('production','sales')), ADD COLUMN deal_id int REFERENCES crm_deals(id) ON DELETE SET NULL;
      CREATE INDEX tasks_deal_idx ON tasks(deal_id, planned_date);
      ALTER TABLE projects ALTER COLUMN budget TYPE numeric(12,2);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    // Keep decimal budgets: narrowing back to int would irreversibly round existing amounts.
    await q.query(
      'ALTER TABLE tasks DROP COLUMN deal_id, DROP COLUMN business_kind; DROP TABLE crm_activities, crm_deals, crm_stages, crm_contacts, crm_companies',
    );
  }
}
