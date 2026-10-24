import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwPush } from '@angular/service-worker';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { TodayCountService } from './today-count.service';

export type PushSupportState = 'unsupported' | 'blocked' | 'default' | 'granted' | 'no-vapid';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private readonly todayCount = inject(TodayCountService);

  readonly supportState = signal<PushSupportState>('unsupported');
  readonly subscribedOnDevice = signal(false);
  readonly loading = signal(false);
  readonly canSubscribeOnDevice = computed(() => {
    const state = this.supportState();
    return state === 'default' || state === 'granted';
  });
  readonly canTestPushFromServer = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return false;
    return !!environment.vapidPublicKey?.trim();
  });

  async initAfterLogin(): Promise<void> {
    this.syncSupportState();
    if (!this.canSubscribeOnDevice()) return;
    await this.refreshDeviceState();
  }

  /** Sync support state — safe to call outside async handlers; do not call from template. */
  syncSupportState(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.supportState.set('unsupported');
      return;
    }

    if (!environment.vapidPublicKey?.trim()) {
      this.supportState.set('no-vapid');
      return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !this.swPush?.isEnabled) {
      this.supportState.set('unsupported');
      return;
    }

    const permission = Notification.permission;
    if (permission === 'denied') {
      this.supportState.set('blocked');
      return;
    }

    this.supportState.set(permission === 'granted' ? 'granted' : 'default');
  }

  /** @deprecated Use canSubscribeOnDevice computed — kept for internal checks without signal writes. */
  isBrowserSupported(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (!environment.vapidPublicKey?.trim()) return false;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    if (!this.swPush?.isEnabled) return false;
    return Notification.permission !== 'denied';
  }

  async refreshDeviceState(): Promise<void> {
    this.syncSupportState();

    if (!this.isBrowserSupported()) {
      this.subscribedOnDevice.set(false);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    this.subscribedOnDevice.set(!!existing);
  }

  async subscribe(): Promise<void> {
    if (!this.isBrowserSupported() || !this.swPush) {
      throw new Error('Push notifications are not supported in this browser.');
    }

    this.loading.set(true);
    try {
      const subscription = await this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey,
      });

      await this.saveSubscription(subscription);
      this.supportState.set('granted');
      this.subscribedOnDevice.set(true);
      await this.todayCount.refresh();
    } finally {
      this.loading.set(false);
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.isBrowserSupported() || !this.swPush) return;

    this.loading.set(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await this.removeSubscriptionFromDb(existing.endpoint);
        await existing.unsubscribe();
      }
      await this.swPush.unsubscribe();
      this.subscribedOnDevice.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  async clearAllForUser(): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    await this.supabaseService.supabase.from('push_subscriptions').delete().eq('user_id', userId);

    if (this.isBrowserSupported() && this.swPush) {
      try {
        await this.swPush.unsubscribe();
      } catch {
        /* ignore */
      }
    }

    this.subscribedOnDevice.set(false);
  }

  private async saveSubscription(subscription: PushSubscription): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('Not authenticated');

    const json = subscription.toJSON();
    const p256dh = json.keys?.['p256dh'];
    const auth = json.keys?.['auth'];
    if (!json.endpoint || !p256dh || !auth) {
      throw new Error('Invalid push subscription');
    }

    const { error } = await this.supabaseService.supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 500),
      },
      { onConflict: 'user_id,endpoint' },
    );

    if (error) throw error;
  }

  private async removeSubscriptionFromDb(endpoint: string): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    await this.supabaseService.supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
  }
}
