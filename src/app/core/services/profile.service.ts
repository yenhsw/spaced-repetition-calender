import { Injectable, inject } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { UserProfile } from '../models/profile.model';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly supabaseService = inject(SupabaseService);

  /**
   * Create profile via security-definer RPC (bypasses RLS).
   * Requires migration 006_backfill_and_ensure_profiles.sql in Supabase.
   */
  async ensureProfile(user: User): Promise<UserProfile> {
    const existing = await this.fetchProfile(user.id);
    if (existing) return existing;

    const { data, error } = await this.supabaseService.supabase.rpc('ensure_user_profile', {
      p_user_id: user.id,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'PGRST202' || error.message.includes('404') || error.message.includes('ensure_user_profile')) {
        throw new Error(
          'RPC ensure_user_profile not found. Run supabase/migrations/006_backfill_and_ensure_profiles.sql in Supabase SQL Editor.',
        );
      }
      throw error;
    }
    return data as UserProfile;
  }

  async fetchProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.supabaseService.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data as UserProfile | null;
  }

  async searchProfiles(keyword: string): Promise<UserProfile[]> {
    let query = this.supabaseService.supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (keyword.trim()) {
      query = query.or(`email.ilike.%${keyword}%,display_name.ilike.%${keyword}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as UserProfile[];
  }

  async listAllProfiles(): Promise<UserProfile[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as UserProfile[];
  }
}
