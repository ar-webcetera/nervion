export enum TASK_STATUSES {
  archive = "archive",
  open = "open",
  to_do = "to_do",
  in_progress = "in_progress",
  waiting = "waiting",
  in_review = "in_review",
  control = "control",
  closed = "closed",
}

/** Persistent stage key. Built-in keys retain their business meaning. */
export type TaskStatus = string;
