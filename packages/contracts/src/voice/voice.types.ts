export interface VoiceRoomUser {
  id: number;
  first_name: string;
  last_name: string;
  photo_url: string | null;
}

export interface VoiceRoomActiveParticipant {
  userId: number;
  displayName: string;
  photoUrl: string | null;
}

export interface VoiceRoom {
  id: number;
  name: string;
  owner_id: number;
  owner: VoiceRoomUser;
  members: VoiceRoomUser[];
  active_participants: VoiceRoomActiveParticipant[];
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateVoiceRoomRequest {
  name: string;
  member_ids: number[];
}

export type UpdateVoiceRoomRequest = Partial<CreateVoiceRoomRequest>;
