import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { HEALTHCHECK_MAX_TIMEOUT_SECONDS } from '@tracker/contracts';
import { CreateHealthCheckDto } from './create-healthcheck.dto';
import { UpdateHealthCheckDto } from './update-healthcheck.dto';

describe('healthcheck timeout boundary', () => {
  const valid = {
    name: 'API',
    url: 'https://example.com/health',
    interval_seconds: 60,
    chat_id: '11111111-1111-4111-8111-111111111111',
    sender_user_id: 1,
  };

  it('exposes the same thirty-second maximum to all clients', () => {
    expect(HEALTHCHECK_MAX_TIMEOUT_SECONDS).toBe(30);
  });

  it.each([CreateHealthCheckDto, UpdateHealthCheckDto])('accepts the existing thirty-second timeout in %p', (Dto) => {
    const dto = Object.assign(new Dto(), valid, { timeout_seconds: 30 });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.timeout_seconds).toBe(30);
  });

  it.each([CreateHealthCheckDto, UpdateHealthCheckDto])('rejects thirty-one seconds in %p', (Dto) => {
    const dto = Object.assign(new Dto(), valid, { timeout_seconds: 31 });
    const errors = validateSync(dto);
    expect(errors.map((error) => error.property)).toEqual(['timeout_seconds']);
    expect(errors[0].constraints?.max).toBeDefined();
  });

  it.each([CreateHealthCheckDto, UpdateHealthCheckDto])('keeps the timeout optional in %p', (Dto) => {
    expect(validateSync(Object.assign(new Dto(), valid))).toEqual([]);
  });
});
