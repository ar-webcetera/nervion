import { ROLES } from '~/types/user';

const optInFeatures = new Set(['mail', 'git', 'voice', 'healthchecks']);
const menuFeatures: Record<string, string> = {
  home: 'tasks',
  planning: 'tasks',
  calendar: 'tasks',
  report: 'reports',
  'mail-accounts': 'mail',
};

export const isTenantFeatureEnabled = (flags: Record<string, boolean> | undefined, feature: string): boolean =>
  optInFeatures.has(feature) ? flags?.[feature] === true : flags?.[feature] !== false;

export const getTenantMenuFeature = (key: string): string => menuFeatures[key] ?? key;

export const getTenantRouteFeature = (path: string): string => getTenantMenuFeature(path.split('/')[1] || 'home');

export const getTenantLandingPath = (canUse: (feature: string) => boolean, role?: ROLES): string => {
  if (canUse('tasks')) return '/';
  if (canUse('projects')) return '/projects';
  if (canUse('chat')) return '/chat';
  if (role === ROLES.admin || role === ROLES.employee) {
    if (canUse('wiki')) return '/wiki';
    if (canUse('mail')) return '/mail';
  }
  if (role === ROLES.admin) {
    if (canUse('crm')) return '/crm/deals';
    if (canUse('reports')) return '/report';
    if (canUse('git')) return '/git';
    if (canUse('healthchecks')) return '/healthchecks';
  }
  // This page keeps the default layout and profile available without opening a disabled module.
  return '/403';
};
