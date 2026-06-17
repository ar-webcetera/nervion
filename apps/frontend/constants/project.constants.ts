export enum PROJECT_STATUSES {
  in_progress = 'in_progress',
  on_hold = 'on_hold',
}

export interface ProjectStatusOption {
  label: string;
  value: PROJECT_STATUSES;
  color: string;
}

export const PROJECT_STATUS_OPTIONS = [
  {
    label: 'В работе',
    value: PROJECT_STATUSES.in_progress,
    color: '#F59E0B',
  },
  {
    label: 'На паузе',
    value: PROJECT_STATUSES.on_hold,
    color: '#10B981',
  },
];

export const getStatusColor = (status: string): string => {
  const statusOption = PROJECT_STATUS_OPTIONS.find((option) => option.value === status);
  return statusOption?.color || '#FFFFFF';
};
