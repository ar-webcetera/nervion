import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';

@Module({
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
