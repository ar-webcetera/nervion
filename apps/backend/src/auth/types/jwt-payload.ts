export interface JwtPayload {
  id: number;
  email: string;
  role: string;
  userId?: number;
  telegram_user_id?: string | null;
  first_name?: string;
  last_name?: string;
  patronymic?: string | null;
  photo_url?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  deletedAt?: string | Date | null;
}
