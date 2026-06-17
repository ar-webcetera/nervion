import { TASK_STATUSES } from 'src/common/enums/statuses.enum';

class Card {
  id: number;
  title: string;
  description: string;
  status: TASK_STATUSES;
  story_points: number | null;
  planned_date: string | null;
  closed_date: Date | null;
}

class Column {
  id: number;
  title: string;
  status: TASK_STATUSES;
  cards: Card[];
}

export class GetKanbanByFilterResponse {
  columns: Column[];
}
