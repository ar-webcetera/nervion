import type { SelectOption } from '~/types/select';

export enum FilterType {
  STATUS = 'status',
  PROJECT = 'project',
  RESPONSIBLE = 'responsible',
  TASK_TYPE = 'taskType',
  BUSINESS_KIND = 'businessKind',
  COMPANY = 'company',
  SOURCE = 'source',
  DEAL_QUICK = 'dealQuick',
  DATE = 'date',
  CLOSED_DATE = 'closed_date',
  SEARCH = 'search',
}

export interface FilterDefinition {
  type: FilterType;
  label: string;
  options: SelectOption[];
}

export interface FilterChip {
  id: string;
  type: FilterType;
  label: string;
  value: string | number | string[];
  isNegative: boolean;
  canNegate?: boolean;
}
