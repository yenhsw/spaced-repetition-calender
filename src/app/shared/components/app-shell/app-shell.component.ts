import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { TodayCountService } from '../../../core/services/today-count.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TranslationService } from '../../../core/i18n/translation.service';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LanguageSwitcherComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent implements OnInit {
  protected readonly authService = inject(AuthService);
  protected readonly todayCount = inject(TodayCountService);
  private readonly i18n = inject(TranslationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
    void this.todayCount.refresh();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (typeof window !== 'undefined') {
          window.scrollTo(0, 0);
        }
        void this.todayCount.refresh();
      });

    if (typeof document !== 'undefined') {
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') {
          void this.todayCount.refresh();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
    }
  }

  todayBadgeAriaLabel(): string {
    return this.i18n.t('nav.todayBadge', { count: this.todayCount.count() });
  }

  async signOut(): Promise<void> {
    await this.authService.signOut();
  }

}
