import { toNervionMessageTagValue } from './postbox.service';

describe('toNervionMessageTagValue', () => {
  it('оставляет UUID без домена и запрещённых символов', () => {
    expect(toNervionMessageTagValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890@webcetera.ru')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('убирает угловые скобки', () => {
    expect(toNervionMessageTagValue('<uuid-here@example.com>')).toBe('uuid-here');
  });
});
