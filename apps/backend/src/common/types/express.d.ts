import type { Users } from '~/users/entities/users.entity';

declare module 'express' {
  interface Request {
    cookies: Record<string, string>;
    user?: Users;
  }
}
