import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserProfile } from '../models/profile.model';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly supabaseService = inject(SupabaseService);

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
