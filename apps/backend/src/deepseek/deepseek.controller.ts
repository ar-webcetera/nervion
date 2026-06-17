import { Body, Controller, Post } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseTextDto } from './dto/parse-text.dto';
import { ParsedTaskDto } from './dto/parsed-task.dto';

@ApiTags('Deepseek')
@Controller('deepseek')
export class DeepseekController {
  constructor(private readonly deepseekService: DeepseekService) {}

  @Post('parse-text-to-task')
  @ApiOperation({ summary: 'Парсинг текста в задачу с помощью GPT' })
  @ApiBody({ type: ParseTextDto })
  @ApiResponse({
    status: 200,
    description: 'Задача успешно спарсена',
    type: ParsedTaskDto,
  })
  async parseTextToTask(@Body() body: ParseTextDto) {
    return this.deepseekService.parseTextToTaskGpt(body.text, body.instruction);
  }
}
