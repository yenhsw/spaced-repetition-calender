import { UserRole } from '../enums/user-role.enum';

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use UserProfile */
export type Profile = UserProfile;
