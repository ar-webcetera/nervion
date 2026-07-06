export enum ROLES {
  admin = 'admin',
  employee = 'employee',
  guest = 'guest',
}

export const roleNames = {
  [ROLES.admin]: 'Администратор',
  [ROLES.employee]: 'Сотрудник',
  [ROLES.guest]: 'Гость',
};

export enum PROJECT_ROLES {
  developer = 'developer',
  designer = 'designer',
}

export enum GRADES {
  junior = 'junior',
  middle = 'middle',
  senior = 'senior',
}
export interface Employee {
  user_id: number;
  cost: number;
  first_name?: string;
  last_name?: string;
  patronymic?: string;
}

export interface User {
  role: ROLES;
  id: number;
  first_name: string;
  last_name: string;
  patronymic: string;
  email: string;
  telegram_user_id?: number;
  photo_url?: string;
  yandex_linked?: boolean;
  hidden_menu_items?: string[];
  deleted_at?: string | null;
}
