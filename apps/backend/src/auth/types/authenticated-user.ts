import { Users } from '../../users/entities/users.entity';

export type AuthenticatedUser = Pick<
  Users,
  | 'id'
  | 'telegram_user_id'
  | 'first_name'
  | 'last_name'
  | 'patronymic'
  | 'email'
  | 'photo_url'
  | 'role'
  | 'hidden_menu_items'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;
