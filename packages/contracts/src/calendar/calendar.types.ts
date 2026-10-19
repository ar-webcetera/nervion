import { CalendarParticipationStatus } from "./calendar.enums";

export interface CalendarUser {
  id: number;
  first_name: string;
  last_name: string;
  patronymic: string | null;
  email: string | null;
  photo_url: string | null;
}

export interface CalendarParticipant extends CalendarUser {
  participation_status: CalendarParticipationStatus;
  responded_at: string | null;
}

export interface CalendarEvent {
  id: number;
  title: string;
  notes: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  reminder_minutes: number;
  creator_id: number;
  creator: CalendarUser;
  participants: CalendarParticipant[];
  created_at: string;
  updated_at: string;
}

export interface CreateCalendarEventRequest {
  title: string;
  notes?: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  reminder_minutes: number;
  participant_ids: number[];
}

export type UpdateCalendarEventRequest = Partial<CreateCalendarEventRequest>;
