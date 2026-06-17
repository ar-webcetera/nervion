import { ROLES } from '../common/enums/roles.enum';

const TASK_ALIAS_PATTERN = /^task\+(\d+)@/i;

// Message-ID храним в каноничном виде: без угловых скобок и пробелов
export function normalizeMessageId(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/^<|>$/g, '').trim();

  return trimmed.length > 0 ? trimmed : null;
}

export function parseTaskIdFromAddress(address?: string | null): number | null {
  if (!address) {
    return null;
  }

  const match = address.trim().match(TASK_ALIAS_PATTERN);

  if (!match) {
    return null;
  }

  const taskId = Number(match[1]);

  return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null;
}

// Все ссылки на предыдущие письма треда: In-Reply-To + References
export function extractReferencedIds(inReplyTo?: string | null, referencesHeader?: string | null): string[] {
  const ids = new Set<string>();

  const inReplyToId = normalizeMessageId(inReplyTo);
  if (inReplyToId) {
    ids.add(inReplyToId);
  }

  for (const part of (referencesHeader ?? '').split(/\s+/)) {
    const id = normalizeMessageId(part);
    if (id) {
      ids.add(id);
    }
  }

  return [...ids];
}

export function buildReferencesHeader(prevReferencesHeader: string | null, prevMessageId: string | null): string | null {
  const ids = extractReferencedIds(null, prevReferencesHeader);
  const prevId = normalizeMessageId(prevMessageId);

  if (prevId && !ids.includes(prevId)) {
    ids.push(prevId);
  }

  if (ids.length === 0) {
    return null;
  }

  return ids.map((id) => `<${id}>`).join(' ');
}

interface AccountAccessUser {
  id: number;
  role: ROLES;
}

interface AccountAccessTarget {
  // Список пользователей, которым открыт доступ к ящику. Доступ — только по явному гранту,
  // спец-привилегии у админа на ЧТЕНИЕ нет (он лишь управляет грантами в админке).
  allowedUsers?: { id: number }[] | null;
}

export function canAccessAccount(user: AccountAccessUser, account: AccountAccessTarget): boolean {
  if (user.role === ROLES.guest) {
    return false;
  }

  return (account.allowedUsers ?? []).some((u) => u.id === user.id);
}
