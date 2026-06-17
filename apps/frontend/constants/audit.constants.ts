import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS } from '@tracker/contracts';

type AuditOption<T extends string> = {
  value: T;
  label: string;
};

const createAuditOptions = <T extends string>(labels: Record<T, string>): AuditOption<T>[] => {
  return (Object.entries(labels) as Array<[T, string]>).map(([value, label]) => ({
    value,
    label,
  }));
};

export { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS };

export const AUDIT_ACTION_OPTIONS = createAuditOptions(AUDIT_ACTION_LABELS);

export const AUDIT_ENTITY_OPTIONS = createAuditOptions(AUDIT_ENTITY_LABELS);
