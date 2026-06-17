export enum PROJECT_MEMBER_ROLES {
  DESIGNER = 'designer',
  DEVELOPER = 'developer',
  SYSADMIN = 'sysadmin',
  TESTER = 'tester',
  TEAMLEAD = 'teamlead',
}

export const ROLE_OPTIONS = [
  { label: 'Дизайнер', value: PROJECT_MEMBER_ROLES.DESIGNER },
  { label: 'Разработчик', value: PROJECT_MEMBER_ROLES.DEVELOPER },
  { label: 'Сисадмин', value: PROJECT_MEMBER_ROLES.SYSADMIN },
  { label: 'Тестировщик', value: PROJECT_MEMBER_ROLES.TESTER },
  { label: 'Тимлид', value: PROJECT_MEMBER_ROLES.TEAMLEAD },
];

export const getRoleLabel = (role: string): string => {
  const roleOption = ROLE_OPTIONS.find((option) => option.value === role);
  return roleOption?.label || role;
};
