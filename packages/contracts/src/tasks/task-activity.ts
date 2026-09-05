import type { AuditActionType } from "../audit/audit-action-type.enum";

export interface TaskActivityChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

/** Public task history. Does not expose request metadata or raw audit payloads. */
export interface TaskActivityItem {
  id: number;
  action_type: AuditActionType;
  actor_name: string;
  created_at: string;
  changes: TaskActivityChange[];
}
