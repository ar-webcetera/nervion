import { ROLES } from '../common/enums/roles.enum';
import {
  buildReferencesHeader,
  canAccessAccount,
  extractReferencedIds,
  normalizeMessageId,
  parseTaskIdFromAddress,
} from './mailbox.utils';

describe('mailbox.utils', () => {
  describe('normalizeMessageId', () => {
    it('убирает угловые скобки и пробелы', () => {
      expect(normalizeMessageId(' <abc@webcetera.ru> ')).toBe('abc@webcetera.ru');
    });

    it('возвращает null для пустых значений', () => {
      expect(normalizeMessageId(null)).toBeNull();
      expect(normalizeMessageId(undefined)).toBeNull();
      expect(normalizeMessageId('  ')).toBeNull();
      expect(normalizeMessageId('<>')).toBeNull();
    });
  });

  describe('parseTaskIdFromAddress', () => {
    it('извлекает ID задачи из plus-адреса', () => {
      expect(parseTaskIdFromAddress('task+123@webcetera.ru')).toBe(123);
      expect(parseTaskIdFromAddress('TASK+7@webcetera.ru')).toBe(7);
    });

    it('возвращает null для обычных адресов', () => {
      expect(parseTaskIdFromAddress('info@webcetera.ru')).toBeNull();
      expect(parseTaskIdFromAddress('task@webcetera.ru')).toBeNull();
      expect(parseTaskIdFromAddress('task+abc@webcetera.ru')).toBeNull();
      expect(parseTaskIdFromAddress(null)).toBeNull();
    });
  });

  describe('extractReferencedIds', () => {
    it('собирает ID из In-Reply-To и References без дублей', () => {
      const ids = extractReferencedIds('<a@x.ru>', '<a@x.ru> <b@x.ru>');

      expect(ids).toEqual(['a@x.ru', 'b@x.ru']);
    });

    it('пустой вход — пустой список', () => {
      expect(extractReferencedIds(null, null)).toEqual([]);
    });
  });

  describe('buildReferencesHeader', () => {
    it('добавляет Message-ID предыдущего письма в конец цепочки', () => {
      expect(buildReferencesHeader('<a@x.ru>', 'b@x.ru')).toBe('<a@x.ru> <b@x.ru>');
    });

    it('не дублирует уже присутствующий ID', () => {
      expect(buildReferencesHeader('<a@x.ru> <b@x.ru>', '<b@x.ru>')).toBe('<a@x.ru> <b@x.ru>');
    });

    it('null когда нечего собирать', () => {
      expect(buildReferencesHeader(null, null)).toBeNull();
    });
  });

  describe('canAccessAccount', () => {
    const withAccess = (...ids: number[]) => ({ allowedUsers: ids.map((id) => ({ id })) });

    it('доступ только по явному гранту — даже у админа', () => {
      expect(canAccessAccount({ id: 1, role: ROLES.admin }, withAccess(2, 3))).toBe(false);
      expect(canAccessAccount({ id: 1, role: ROLES.admin }, withAccess(1))).toBe(true);
    });

    it('сотрудник видит ящик, только если он в списке доступа', () => {
      expect(canAccessAccount({ id: 5, role: ROLES.employee }, withAccess(5))).toBe(true);
      expect(canAccessAccount({ id: 5, role: ROLES.employee }, withAccess(6))).toBe(false);
      expect(canAccessAccount({ id: 5, role: ROLES.employee }, { allowedUsers: [] })).toBe(false);
    });

    it('гость не видит ничего, даже с грантом', () => {
      expect(canAccessAccount({ id: 5, role: ROLES.guest }, withAccess(5))).toBe(false);
    });
  });
});
