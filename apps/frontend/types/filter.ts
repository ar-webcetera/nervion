export enum FilterType {
  STATUS = 'status',
  PROJECT = 'project',
  RESPONSIBLE = 'responsible',
  TASK_TYPE = 'taskType',
  DATE = 'date',
  CLOSED_DATE = 'closed_date',
  SEARCH = 'search',
}

export interface FilterChip {
  id: string;
  type: FilterType;
  label: string;
  value: string | number | string[];
  isNegative: boolean;
}
