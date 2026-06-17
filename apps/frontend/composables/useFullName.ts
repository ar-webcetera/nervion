import type { User } from '~/types/user';

export const useFullName = (user: User) => {
  if (!user) return null;
  const parts = [user.last_name, user.first_name];
  if (user.patronymic) parts.push(user.patronymic);
  return parts.join(' ');
};
