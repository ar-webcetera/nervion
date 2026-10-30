import { Global, Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { TenantSocketService } from './tenant-socket.service';

@Global()
@Module({
  providers: [WebsocketGateway, TenantSocketService],
  exports: [WebsocketGateway, TenantSocketService],
})
export class WebsocketModule {}
