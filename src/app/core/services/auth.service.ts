import { Injectable, Injector, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { ProfileService } from './profile.service';
import { PushNotificationService } from './push-notification.service';
import { TodayCountService } from './today-count.service';
import { UserProfile } from '../models/profile.model';
import { UserRole } from '../enums/user-role.enum';
import { normalizeUsername, usernameToAuthEmail } from '../utils/auth.utils';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly profileService = inject(ProfileService);
  private readonly injector = inject(Injector);
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
      let profile = await this.profileService.fetchProfile(session.user.id);
      if (!profile) {
        profile = await this.profileService.ensureProfile(session.user);
      }
      this.profileSignal.set(profile);
      await this.runPushInitAfterLogin();
      await this.runTodayCountRefreshAfterLogin();
    } else {
      this.profileSignal.set(null);
    }

    this.loadingSignal.set(false);
  }

  async signUp(username: string, password: string, displayName?: string): Promise<void> {
    const normalized = normalizeUsername(username);
    const name = displayName?.trim() || normalized;

    const { data, error } = await this.supabaseService.supabase.auth.signUp({
      email: usernameToAuthEmail(normalized),
      password,
      options: {
        data: {
          display_name: name,
          username: normalized,
        },
      },
    });
    if (error) throw error;

    if (!data.session) {
      await this.signIn(normalized, password);
    } else {
      await this.handleSession(data.session);
    }
  }

  async signIn(username: string, password: string): Promise<void> {
    const { error } = await this.supabaseService.supabase.auth.signInWithPassword({
      email: usernameToAuthEmail(username),
      password,
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.runPushClearOnLogout();
    const { error } = await this.supabaseService.supabase.auth.signOut();
    if (error) throw error;
    this.profileSignal.set(null);
    this.sessionSignal.set(null);
    await this.router.navigate(['/login']);
  }

  getCurrentUser(): User | null {
    return this.sessionSignal()?.user ?? null;
  }

  private async runPushInitAfterLogin(): Promise<void> {
    try {
      await this.injector.get(PushNotificationService).initAfterLogin();
    } catch {
      /* push optional */
    }
  }

  private async runTodayCountRefreshAfterLogin(): Promise<void> {
    try {
      await this.injector.get(TodayCountService).refresh();
    } catch {
      /* optional */
    }
  }

  private async runPushClearOnLogout(): Promise<void> {
    try {
      await this.injector.get(PushNotificationService).clearAllForUser();
    } catch {
      /* push optional */
    }
    try {
      this.injector.get(TodayCountService).clear();
    } catch {
      /* optional */
    }
  }
}
