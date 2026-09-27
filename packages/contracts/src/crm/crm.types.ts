import type { JsonObject } from "../common/json";
import type {
  CrmStageKind,
  CrmActivityKind,
  TaskBusinessKind,
} from "./crm.enums";
import type { TASK_STATUSES } from "../tasks/task-status.enum";
export interface CrmCompany {
  id: number;
  name: string;
  legal_name: string;
  inn: string;
  website: string;
  notes: string;
  responsible_id: number | null;
}
export interface CrmContact {
  id: number;
  name: string;
  last_name: string;
  patronymic: string;
  company_id: number | null;
  position: string;
  phone: string;
  email: string;
  telegram: string;
}
export interface CrmStage {
  id: number;
  name: string;
  position: number;
  kind: CrmStageKind;
}
export interface CrmDeal {
  id: number;
  title: string;
  stage_id: number;
  amount: string | null;
  company_id: number | null;
  contact_ids: number[];
  primary_contact_id: number | null;
  responsible_id: number | null;
  source: string;
  expected_close: string | null;
  project_id: number | null;
  description: JsonObject | null;
  loss_reason: string | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
  responsible_name: string | null;
  next_task: CrmTask | null;
}
export interface CrmTask {
  id: number;
  title: string;
  planned_date: string | null;
  status: TASK_STATUSES;
  business_kind: TaskBusinessKind;
}
export interface CrmActivity {
  id: number;
  kind: CrmActivityKind;
  message: JsonObject | null;
  summary: string;
  author_name: string;
  created_at: string;
}
export interface CrmDealDetail extends CrmDeal {
  tasks: CrmTask[];
  activities: CrmActivity[];
}
export interface CrmColumn {
  stage: CrmStage;
  total: number;
  amount: string;
  cards: CrmDeal[];
  has_more: boolean;
}
export interface CrmOptions {
  company_stats: Record<number, { count: number; amount: string }>;
  stages: CrmStage[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  users: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  sources: string[];
  loss_reasons: string[];
  collapsed_stage_ids: number[];
}
