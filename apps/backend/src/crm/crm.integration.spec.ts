import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { resolve } from 'path';
import type { Server } from 'http';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthService } from '../auth/jwt.service';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';
import { CrmModule } from './crm.module';
import { DeepseekModule } from '../deepseek/deepseek.module';
import { DeepseekService } from '../deepseek/deepseek.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { CommentsModule } from '../comments/comments.module';
import { CRM_DEFAULT_SOURCES, CrmColumn, CrmDealDetail, CrmOptions, TaskBusinessKind } from '@tracker/contracts';
import { Tasks } from '../tasks/entities/task.entity';
import { Projects } from '../projects/entities/project.entity';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

@Module({ providers: [{ provide: DeepseekService, useValue: {} }], exports: [DeepseekService] })
class TestAiModule {}
@Module({
  providers: [{ provide: NotificationsService, useValue: { createWithEmail: jest.fn() } }],
  exports: [NotificationsService],
})
class TestNotificationsModule {}

// Explicit opt-in: this suite only runs against a dedicated disposable database.
const databaseUrl = process.env.CRM_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('CRM integration (disposable PostgreSQL)', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;
  let db: DataSource;
  let adminCookie: string;
  let employeeCookie: string;
  let adminId: number;
  let employeeId: number;
  let dealId: number;
  let salesId: number;
  let productionId: number;
  beforeAll(async () => {
    if (!databaseUrl?.includes('crm_test')) throw new Error('Use a dedicated crm_test database');
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'crm-local-test-only-secret' })],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: databaseUrl,
          entities: [resolve(__dirname, '../**/*.entity.ts')],
          migrations: [resolve(__dirname, '../migrations/*.ts')],
          migrationsRun: true,
          synchronize: false,
        }),
        AuthModule,
        CrmModule,
        CommentsModule,
      ],
    })
      .overrideModule(DeepseekModule)
      .useModule(TestAiModule)
      .overrideModule(NotificationsModule)
      .useModule(TestNotificationsModule)
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true, exposeUnsetFields: false },
      }),
    );
    await app.init();
    db = app.get(DataSource);
    const users = db.getRepository(Users);
    const admin = await users.save(
      users.create({
        email: `crm-admin-${Date.now()}@test.invalid`,
        first_name: 'Анна',
        last_name: 'Продажи',
        role: ROLES.admin,
      }),
    );
    const employee = await users.save(
      users.create({
        email: `crm-employee-${Date.now()}@test.invalid`,
        first_name: 'Иван',
        last_name: 'Разработка',
        role: ROLES.employee,
      }),
    );
    adminId = admin.id;
    employeeId = employee.id;
    const jwt = app.get(JwtAuthService);
    adminCookie = `authToken=${jwt.generateToken({ id: admin.id, email: admin.email, role: admin.role })}`;
    employeeCookie = `authToken=${jwt.generateToken({ id: employee.id, email: employee.email, role: employee.role })}`;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('creates a company, contact and linked deal with an admin API token, without cookies', async () => {
    const issued = await request(server())
      .post('/api/api-tokens')
      .set('Cookie', adminCookie)
      .send({ name: 'CRM integration test' })
      .expect(201);
    const { token, record } = issued.body as { token: string; record: { id: number } };
    const authorization = `Bearer ${token}`;
    await request(server()).post('/api/crm/companies').set('Authorization', authorization).send({ name: '   ' }).expect(400);
    await request(server()).post('/api/crm/contacts').set('Authorization', authorization).send({ name: '   ' }).expect(400);
    const company = await request(server())
      .post('/api/crm/companies')
      .set('Authorization', authorization)
      .send({ name: 'Клиент из API', inn: '1234567890' })
      .expect(201);
    const companyId = (company.body as { id: number }).id;
    await request(server())
      .post('/api/crm/companies')
      .set('Authorization', authorization)
      .send({ name: '  КЛИЕНТ ИЗ API  ' })
      .expect(409);
    const userCount = await db.getRepository(Users).count();
    const contact = await request(server())
      .post('/api/crm/contacts')
      .set('Authorization', authorization)
      .send({
        name: 'Иван',
        last_name: 'Петров',
        patronymic: 'Сергеевич',
        company_id: companyId,
        phone: '+7 900 000-00-00',
        email: 'client@example.test',
        telegram: '@ClientLead',
      })
      .expect(201);
    expect(contact.body).toMatchObject({ name: 'Иван', last_name: 'Петров', patronymic: 'Сергеевич' });
    const contactId = (contact.body as { id: number }).id;
    await request(server())
      .post('/api/crm/contacts')
      .set('Authorization', authorization)
      .send({ name: 'Дубликат телефона', phone: '79000000000' })
      .expect(409);
    await request(server())
      .post('/api/crm/contacts')
      .set('Authorization', authorization)
      .send({ name: 'Дубликат email', email: ' CLIENT@EXAMPLE.TEST ' })
      .expect(409);
    await request(server())
      .post('/api/crm/contacts')
      .set('Authorization', authorization)
      .send({ name: 'Дубликат Telegram', telegram: 'clientlead' })
      .expect(409);
    await request(server())
      .patch(`/api/crm/contacts/${contactId}`)
      .set('Authorization', authorization)
      .send({ phone: '+7 (900) 000-00-00', email: 'client@example.test', telegram: '@ClientLead' })
      .expect(200);
    const created = await request(server())
      .post('/api/crm/deals')
      .set('Authorization', authorization)
      .send({
        title: 'Заявка с сайта',
        amount: 150000.5,
        company_id: companyId,
        contact_ids: [contactId],
        primary_contact_id: contactId,
        source: 'Сайт',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      responsible_id: adminId,
      company_id: companyId,
      primary_contact_id: contactId,
      amount: '150000.50',
    });
    expect(await db.getRepository(Users).count()).toBe(userCount);
    await request(server())
      .patch(`/api/crm/deals/${(created.body as CrmDealDetail).id}`)
      .set('Authorization', authorization)
      .send({ source: 'amoCRM' })
      .expect(200);
    const options = await request(server()).get('/api/crm/options').set('Authorization', authorization).expect(200);
    expect((options.body as CrmOptions).sources).toEqual(expect.arrayContaining([...CRM_DEFAULT_SOURCES]));
    await request(server()).post('/api/crm/deals').set('Authorization', authorization).send({}).expect(400);
    await request(server()).delete(`/api/api-tokens/${record.id}`).set('Cookie', adminCookie).expect(204);
    await request(server()).get('/api/crm/options').set('Authorization', authorization).expect(401);
    const employee = await request(server())
      .post('/api/api-tokens')
      .set('Cookie', employeeCookie)
      .send({ name: 'Employee test' })
      .expect(201);
    await request(server())
      .post('/api/crm/deals')
      .set('Authorization', `Bearer ${(employee.body as { token: string }).token}`)
      .send({ title: 'Недоступная сделка' })
      .expect(403);
    const expired = await request(server())
      .post('/api/api-tokens')
      .set('Cookie', adminCookie)
      .send({ name: 'Expired test', expires_at: '2000-01-01T00:00:00.000Z' })
      .expect(201);
    await request(server())
      .get('/api/crm/options')
      .set('Authorization', `Bearer ${(expired.body as { token: string }).token}`)
      .expect(401);
  });

  it('publishes CRM request fields and API-token authorization in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'api-token').build(),
    );
    expect(document.paths['/api/crm/deals'].post?.security).toContainEqual({ 'api-token': [] });
    const schema = document.components?.schemas?.DealDto;
    expect(schema && 'required' in schema && schema.required).toEqual(['title']);
    expect(schema && 'properties' in schema && schema.properties).toHaveProperty('contact_ids');
    const contactSchema = document.components?.schemas?.ContactDto;
    expect(contactSchema && 'required' in contactSchema && contactSchema.required).toEqual(['name']);
    expect(contactSchema && 'properties' in contactSchema && contactSchema.properties).toHaveProperty('last_name');
    expect(contactSchema && 'properties' in contactSchema && contactSchema.properties).toHaveProperty('patronymic');
    const updateSchema = document.components?.schemas?.UpdateDealDto;
    expect(updateSchema && 'properties' in updateSchema && updateSchema.properties).toHaveProperty('amount');
  });

  it('guards CRM and creates a deal from its title alone', async () => {
    await request(server()).get('/api/crm/options').expect(401);
    await request(server()).get('/api/crm/options').set('Cookie', employeeCookie).expect(403);
    const options = await request(server()).get('/api/crm/options').set('Cookie', adminCookie).expect(200);
    expect((options.body as CrmOptions).stages[0]?.name).toBe('Неразобранное');
    expect((options.body as CrmOptions).collapsed_stage_ids).toEqual([7, 8]);
    await request(server())
      .patch('/api/crm/preferences/collapsed-stages')
      .set('Cookie', adminCookie)
      .send({ collapsed_stage_ids: [1, 8] })
      .expect(200);
    const savedOptions = await request(server()).get('/api/crm/options').set('Cookie', adminCookie).expect(200);
    expect((savedOptions.body as CrmOptions).collapsed_stage_ids).toEqual([1, 8]);
    const response = await request(server())
      .post('/api/crm/deals')
      .set('Cookie', adminCookie)
      .send({ title: 'Сайт для компании Альфа' })
      .expect(201);
    const deal = response.body as CrmDealDetail;
    dealId = deal.id;
    expect(deal.responsible_id).toBe(adminId);
    expect(deal.amount).toBeNull();
    expect(deal.stage_id).toBe(1);
  });
  it('creates shared commercial tasks and hides all non-admin access paths', async () => {
    const response = await request(server())
      .post(`/api/crm/deals/${dealId}/tasks`)
      .set('Cookie', adminCookie)
      .send({ title: 'Уточнить решение по КП', planned_date: '2026-01-01' })
      .expect(201);
    salesId = (response.body as Tasks).id;
    await request(server())
      .post(`/api/crm/deals/${dealId}/tasks`)
      .set('Cookie', adminCookie)
      .send({ title: 'Недопустимый исполнитель', responsible_id: employeeId })
      .expect(400);
    await request(server()).get(`/api/tasks/${salesId}`).set('Cookie', employeeCookie).expect(404);
    await request(server()).patch(`/api/tasks/${salesId}`).set('Cookie', employeeCookie).send({ title: 'Взлом' }).expect(404);
    await request(server()).delete(`/api/tasks/${salesId}`).set('Cookie', employeeCookie).expect(404);
    await request(server()).get(`/api/tasks/${salesId}/activity`).set('Cookie', employeeCookie).expect(404);
    const list = await request(server()).get('/api/tasks').set('Cookie', employeeCookie).expect(200);
    expect((list.body as Tasks[]).some((t) => t.id === salesId)).toBe(false);
    const adminList = await request(server()).get('/api/tasks?business_kind=sales').set('Cookie', adminCookie).expect(200);
    expect((adminList.body as Tasks[]).some((t) => t.id === salesId)).toBe(true);
    await request(server()).patch(`/api/tasks/${salesId}`).set('Cookie', adminCookie).send({ status: 'testing' }).expect(400);
  });
  it('protects comments, task links and production responses', async () => {
    const comment = await request(server())
      .post('/api/comments')
      .set('Cookie', adminCookie)
      .send({
        task_id: salesId,
        author_id: adminId,
        message: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Коммерческие условия' }] }] },
      })
      .expect(201);
    const commentId = (comment.body as { id: number }).id;
    await request(server()).get(`/api/comments/${commentId}`).set('Cookie', employeeCookie).expect(404);
    await request(server()).get(`/api/comments?task_id=${salesId}`).set('Cookie', employeeCookie).expect(404);
    const all = await request(server()).get('/api/comments').set('Cookie', employeeCookie).expect(200);
    expect(JSON.stringify(all.body)).not.toContain('Коммерческие условия');
    const prod = await request(server())
      .post('/api/tasks')
      .set('Cookie', adminCookie)
      .send({ title: 'Производственная задача', project_id: 0 })
      .expect(201);
    productionId = (prod.body as Tasks).id;
    await request(server())
      .post(`/api/tasks/${productionId}/links`)
      .set('Cookie', adminCookie)
      .send({ relatedTaskId: String(salesId) })
      .expect(201);
    const visible = await request(server()).get(`/api/tasks/${productionId}`).set('Cookie', employeeCookie).expect(200);
    expect((visible.body as Tasks).related_tasks).toHaveLength(0);
    await request(server())
      .post(`/api/tasks/${productionId}/links`)
      .set('Cookie', employeeCookie)
      .send({ relatedTaskId: String(salesId) })
      .expect(404);
    await request(server())
      .post(`/api/crm/deals/${dealId}/task-links`)
      .set('Cookie', adminCookie)
      .send({ task_id: productionId })
      .expect(201);
    const linked = await request(server()).get(`/api/tasks/${productionId}`).set('Cookie', employeeCookie).expect(200);
    expect(linked.body).not.toHaveProperty('deal_id');
  });
  it('paginates cards without changing totals and derives next action', async () => {
    await request(server()).patch(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).send({ amount: 12345.67 }).expect(200);
    const result = await request(server())
      .get(`/api/crm/columns/1?limit=1&quick=overdue&today=2026-09-27&responsible_id=${adminId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const column = result.body as CrmColumn;
    expect(column.cards[0].next_task?.id).toBe(salesId);
    expect(column.amount).toBe('12345.67');
    await request(server()).patch(`/api/tasks/${salesId}`).set('Cookie', adminCookie).send({ status: 'closed' }).expect(200);
    const detail = await request(server()).get(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).expect(200);
    expect((detail.body as CrmDealDetail).next_task).toBeNull();
    expect((detail.body as CrmDealDetail).stage_id).toBe(1);
    expect((detail.body as CrmDealDetail).activities.some((a) => a.summary.includes('Закрыта'))).toBe(true);
    expect((await db.getRepository(Tasks).findOneByOrFail({ id: salesId })).business_kind).toBe(TaskBusinessKind.SALES);
  });
  it('requires a loss reason and creates exactly one project under concurrent retries', async () => {
    await request(server()).patch(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).send({ stage_id: 8 }).expect(400);
    const unchanged = await request(server()).get(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie);
    expect((unchanged.body as CrmDealDetail).stage_id).toBe(1);
    await request(server())
      .patch(`/api/crm/deals/${dealId}`)
      .set('Cookie', adminCookie)
      .send({ stage_id: 8, loss_reason: 'Дорого' })
      .expect(200);
    await request(server()).patch(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).send({ stage_id: 7 }).expect(200);
    const [a, b] = await Promise.all(
      [1, 2].map(() => request(server()).post(`/api/crm/deals/${dealId}/project`).set('Cookie', adminCookie).expect(201)),
    );
    expect((a.body as { id: number }).id).toBe((b.body as { id: number }).id);
    const project = await db.getRepository(Projects).findOneByOrFail({ id: (a.body as { id: number }).id });
    expect(project.budget).toBe(12345.67);
  });
  it('keeps filtered totals independent of pages and supports standalone contacts', async () => {
    const company = await request(server())
      .post('/api/crm/companies')
      .set('Cookie', adminCookie)
      .send({ name: 'Компания для пагинации' })
      .expect(201);
    const companyId = (company.body as { id: number }).id;
    const contact = await request(server())
      .post('/api/crm/contacts')
      .set('Cookie', adminCookie)
      .send({ name: 'Независимый контакт' })
      .expect(201);
    const contactId = (contact.body as { id: number }).id;
    for (const amount of [100.25, 200.5, null]) {
      await request(server())
        .post('/api/crm/deals')
        .set('Cookie', adminCookie)
        .send({
          title: 'Карточка для пагинации',
          amount,
          company_id: companyId,
          contact_ids: [contactId],
          primary_contact_id: contactId,
        })
        .expect(201);
    }
    const getPage = (offset: number) =>
      request(server())
        .get(`/api/crm/columns/1?company_id=${companyId}&offset=${offset}&limit=1`)
        .set('Cookie', adminCookie)
        .expect(200);
    const first = (await getPage(0)).body as CrmColumn;
    const second = (await getPage(1)).body as CrmColumn;
    const last = (await getPage(2)).body as CrmColumn;
    expect(first.total).toBe(3);
    expect(first.amount).toBe('300.75');
    expect(second.amount).toBe(first.amount);
    expect(first.has_more).toBe(true);
    expect(last.has_more).toBe(false);
    expect(new Set([first, second, last].map((p) => p.cards[0].id)).size).toBe(3);
    const filtered = await request(server())
      .get(`/api/crm/columns/1?contact_id=${contactId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect((filtered.body as CrmColumn).total).toBe(3);
  });
  it('deletes a deal and keeps linked tasks without the CRM relation', async () => {
    await request(server()).delete(`/api/crm/deals/${dealId}`).set('Cookie', employeeCookie).expect(403);
    await request(server()).delete(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).expect(204);
    await request(server()).get(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).expect(404);
    expect((await db.getRepository(Tasks).findOneByOrFail({ id: salesId })).deal_id).toBeNull();
    await request(server()).delete(`/api/crm/deals/${dealId}`).set('Cookie', adminCookie).expect(404);
  });
});
