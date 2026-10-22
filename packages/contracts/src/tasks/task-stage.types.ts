export interface TaskStage {
  id: string;
  title: string;
  position: number;
  protected: boolean;
}

export interface SaveTaskStage {
  title: string;
}
export interface CreateTaskStage extends SaveTaskStage {
  afterStageId?: string;
}
export interface ReorderTaskStages {
  ids: string[];
}
export interface DeleteTaskStage {
  targetStatus?: string;
}

export interface TaskStageDraft extends SaveTaskStage {
  id: string;
}

export interface RemovedTaskStage extends DeleteTaskStage {
  id: string;
}

export interface ApplyTaskStages {
  originalStages: TaskStageDraft[];
  stages: TaskStageDraft[];
  removedStages: RemovedTaskStage[];
}
