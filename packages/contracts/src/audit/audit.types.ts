import type { JsonObject } from "../common/json";
import type { AuditActionType } from "./audit-action-type.enum";
import type { AuditEntityType } from "./audit-entity-type.enum";
import type { AuditSourceType } from "./audit-source-type.enum";

export interface AuditActorPreview {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface AuditLogItem {
  id: number;
  action_type: AuditActionType;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  before_payload: JsonObject | null;
  after_payload: JsonObject | null;
  diff_payload: JsonObject | null;
  metadata_payload: JsonObject | null;
  source_type: AuditSourceType;
  actor_id: number | null;
  actor_name: string | null;
  actor: AuditActorPreview | null;
  project_id: number | null;
  task_id: number | null;
  request_id: string | null;
  request_method: string | null;
  request_path: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogsResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogsFilters {
  page?: number;
  limit?: number;
  action_types?: AuditActionType[];
  entity_types?: AuditEntityType[];
  actor_id?: number | null;
  project_id?: number | null;
  task_id?: number | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
}
