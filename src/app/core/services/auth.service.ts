import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { ProfileService } from './profile.service';
import { UserProfile } from '../models/profile.model';
import { UserRole } from '../enums/user-role.enum';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  private readonly sessionSignal = signal<Session | null>(null);
  private readonly profileSignal = signal<UserProfile | null>(null);
  private readonly loadingSignal = signal(true);

  readonly session = this.sessionSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.sessionSignal());
  readonly isAdmin = computed(() => this.profileSignal()?.role === UserRole.ADMIN);
  readonly userId = computed(() => this.sessionSignal()?.user?.id ?? null);

  async init(): Promise<void> {
    if (!this.supabaseService.isBrowser) {
      this.loadingSignal.set(false);
      return;
    }

    const supabase = this.supabaseService.supabase;

    const { data } = await supabase.auth.getSession();
    await this.handleSession(data.session);

    supabase.auth.onAuthStateChange(async (_event, session) => {
      await this.handleSession(session);
    });
  }

  private async handleSession(session: Session | null): Promise<void> {
    this.sessionSignal.set(session);

    if (session?.user) {
      const profile = await this.profileService.fetchProfile(session.user.id);
      this.profileSignal.set(profile);
    } else {
      this.profileSignal.set(null);
    }

    this.loadingSignal.set(false);
  }

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    const { error } = await this.supabaseService.supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.supabaseService.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async signInWithGoogle(): Promise<void> {
    if (!this.supabaseService.isBrowser) return;

    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await this.supabaseService.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }

  async completeOAuthSignIn(): Promise<void> {
    if (!this.supabaseService.isBrowser) {
      throw new Error('OAuth is only available in the browser');
    }

    const supabase = this.supabaseService.supabase;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Không lấy được session sau OAuth');

    await this.handleSession(data.session);
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabaseService.supabase.auth.signOut();
    if (error) throw error;
    this.profileSignal.set(null);
    this.sessionSignal.set(null);
    await this.router.navigate(['/login']);
  }

  getCurrentUser(): User | null {
    return this.sessionSignal()?.user ?? null;
  }
}
