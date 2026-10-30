import { Body, Controller, Headers, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MailDeliveryService } from './mail-delivery.service';
import type { PostboxEventsIngestBody } from './postbox-events.types';
import { TenantMailConfigService } from './tenant-mail-config.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';

@Controller('mailbox/postbox-events')
@ApiTags('Почта / Postbox events')
export class MailboxPostboxEventsController {
  constructor(private readonly mailDeliveryService: MailDeliveryService, private readonly configuration: TenantMailConfigService, private readonly database: TenantDatabaseService) {}

  @Post()
  @ApiOperation({
    summary: 'Приём событий доставки Postbox (Data Streams → Cloud Function → webhook)',
  })
  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <POSTBOX_EVENTS_WEBHOOK_SECRET>',
    required: true,
  })
  @ApiResponse({ status: 201, description: 'События приняты' })
  @ApiResponse({ status: 401, description: 'Неверный секрет' })
  async ingest(@Headers('authorization') authorization: string | undefined, @Body() body: PostboxEventsIngestBody) {
    if (this.configuration.isEnabled()) throw new NotFoundException();
    this.mailDeliveryService.assertWebhookSecret(authorization);
    return this.mailDeliveryService.ingestPayload(body ?? {});
  }

  @Post(':routingKey')
  async ingestTenant(@Param('routingKey') routingKey: string, @Headers('authorization') authorization: string | undefined, @Body() body: PostboxEventsIngestBody) {
    if (!this.configuration.isEnabled()) throw new NotFoundException();
    const tenant = await this.configuration.authenticateWebhook(routingKey, authorization);
    return this.database.run(tenant, () => this.mailDeliveryService.ingestPayload(body ?? {}));
  }
}
