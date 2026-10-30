import { Users } from '../../users/entities/users.entity';
import type { TenantSessionClaims } from '@tracker/contracts';

export type AuthenticatedUser = Pick<
  Users,
  | 'id'
  | 'telegram_user_id'
  | 'yandex_id'
  | 'first_name'
  | 'last_name'
  | 'patronymic'
  | 'email'
  | 'photo_url'
  | 'role'
  | 'hidden_menu_items'
  | 'selected_mail_account_id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
> &
  Partial<TenantSessionClaims>;
