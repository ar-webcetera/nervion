import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';

export interface RequestWithCookies extends Request {
  user: AuthenticatedUser;
  cookies: {
    authToken?: string;
  };
}
