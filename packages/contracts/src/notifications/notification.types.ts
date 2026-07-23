export interface ReadNotificationContextRequest {
  task_id: number;
  comment_id?: number;
}

export interface ReadNotificationContextResponse {
  notification_ids: number[];
}
