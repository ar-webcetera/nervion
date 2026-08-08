import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MailDeliveryService } from './mail-delivery.service';
import type { PostboxEventsIngestBody } from './postbox-events.types';

@Controller('mailbox/postbox-events')
@ApiTags('Почта / Postbox events')
export class MailboxPostboxEventsController {
  constructor(private readonly mailDeliveryService: MailDeliveryService) {}

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
    this.mailDeliveryService.assertWebhookSecret(authorization);
    return this.mailDeliveryService.ingestPayload(body ?? {});
  }
}
