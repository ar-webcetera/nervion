import type { User } from '~/types/user';

export const useShortName = (user?: User | null) => {
  if (!user) return null;
  const lastInitial = user.last_name?.trim().charAt(0).toUpperCase() || '';
  const firstInitial = user.first_name?.trim().charAt(0).toUpperCase() || '';
  const shortName = `${lastInitial}${firstInitial}`;

  return shortName || null;
};
