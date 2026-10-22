import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly platformId = inject(PLATFORM_ID);
  private client: SupabaseClient | null = null;

  get supabase(): SupabaseClient {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Supabase client is only available in the browser');
    }

    if (!this.client) {
      this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          flowType: 'pkce',
        },
      });
    }

    return this.client;
  }

  get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
