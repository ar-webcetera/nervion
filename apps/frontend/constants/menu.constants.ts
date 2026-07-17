import { PAGE_NAMES } from '~/constants/pages.constants';
import { ROLES } from '~/types/user';

export interface MenuItemMeta {
  key: string;
  label: string;
  page: PAGE_NAMES;
  always?: boolean;
  adminOnly?: boolean;
  employeePlus?: boolean;
}

export const MENU_ITEMS: MenuItemMeta[] = [
  { key: 'home', label: 'Задачи', page: PAGE_NAMES.home, always: true },
  { key: 'projects', label: 'Проекты', page: PAGE_NAMES.projects },
  { key: 'wiki', label: 'Вики', page: PAGE_NAMES.wiki },
  { key: 'chat', label: 'Чаты', page: PAGE_NAMES.CHAT },
  { key: 'mail', label: 'Почта', page: PAGE_NAMES.MAIL, employeePlus: true },
  { key: 'planning', label: 'Планирование', page: PAGE_NAMES.planning, employeePlus: true },
  { key: 'schedule', label: 'График работы', page: PAGE_NAMES.SCHEDULE },
  { key: 'report', label: 'Отчёты', page: PAGE_NAMES.report, adminOnly: true },
  { key: 'users-management', label: 'Управление пользователями', page: PAGE_NAMES.USERS_MANAGEMENT, adminOnly: true },
  { key: 'changelogs', label: 'Changelog', page: PAGE_NAMES.CHANGELOGS, adminOnly: true },
  { key: 'audit-logs', label: 'Журнал действий', page: PAGE_NAMES.AUDIT_LOGS, adminOnly: true },
  { key: 'healthchecks', label: 'Healthcheck-мониторы', page: PAGE_NAMES.HEALTHCHECKS, adminOnly: true },
  { key: 'mail-accounts', label: 'Почтовые ящики', page: PAGE_NAMES.MAIL_ACCOUNTS, adminOnly: true },
  { key: 'git', label: 'Git', page: PAGE_NAMES.GIT, adminOnly: true },
];

export const isMenuItemAllowedForRole = (item: MenuItemMeta, role?: ROLES): boolean => {
  if (item.adminOnly) {
    return role === ROLES.admin;
  }
  if (item.employeePlus) {
    return role === ROLES.admin || role === ROLES.employee;
  }
  return true;
};
