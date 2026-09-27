import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyDto, ContactDto, DealDto } from './crm.dto';

describe('CRM directory DTOs', () => {
  it.each([
    ['company', CompanyDto],
    ['contact', ContactDto],
  ])('rejects a whitespace-only %s name', async (_entity, Dto) => {
    const dto = plainToInstance(Dto, { name: '   ' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it.each([
    ['company', CompanyDto],
    ['contact', ContactDto],
  ])('trims a valid %s name', async (_entity, Dto) => {
    const dto = plainToInstance(Dto, { name: '  Тест  ' });

    expect(dto.name).toBe('Тест');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('trims optional contact name parts', async () => {
    const dto = plainToInstance(ContactDto, {
      name: ' Иван ',
      last_name: ' Петров ',
      patronymic: ' Сергеевич ',
    });

    expect(dto).toMatchObject({ name: 'Иван', last_name: 'Петров', patronymic: 'Сергеевич' });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts only a source from the fixed CRM list', async () => {
    const allowed = plainToInstance(DealDto, { title: 'Сделка', source: 'Сайт' });
    const custom = plainToInstance(DealDto, { title: 'Сделка', source: 'Выставка' });

    await expect(validate(allowed)).resolves.toHaveLength(0);
    await expect(validate(custom)).resolves.not.toHaveLength(0);
  });
});
