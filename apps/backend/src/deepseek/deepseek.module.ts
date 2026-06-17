import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DeepseekController } from './deepseek.controller';
import { DeepseekService } from './deepseek.service';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AI_CLIENT } from './constants/tokens';
import { AI_MODEL } from './constants/tokens';

@Module({
  imports: [HttpModule],
  controllers: [DeepseekController],
  providers: [
    {
      provide: AI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('GEMINI_API_KEY');
        if (!apiKey) {
          console.error('GEMINI_API_KEY не задан в окружении');
          return null;
        }
        return new GoogleGenerativeAI(apiKey);
      },
    },
    {
      provide: AI_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash',
    },
    DeepseekService,
  ],
  exports: [DeepseekService],
})
export class DeepseekModule {}
