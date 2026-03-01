/**
 * User roles in the system
 */
export type Role = 'investor' | 'wholesaler' | 'admin';

/**
 * Profile data required for permission calculation
 */
export interface Profile {
  id: string;
  role: Role;
  is_paid: boolean;
}

