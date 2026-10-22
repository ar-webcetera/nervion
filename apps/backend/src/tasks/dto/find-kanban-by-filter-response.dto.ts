import type { TaskStatus } from '@tracker/contracts';

class Card {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  story_points: number | null;
  planned_date: string | null;
  closed_date: Date | null;
}

class Column {
  id: string;
  title: string;
  status: TaskStatus;
  cards: Card[];
}

export class GetKanbanByFilterResponse {
  columns: Column[];
}
