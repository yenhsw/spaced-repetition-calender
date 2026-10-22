import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-card auth-card--center">
        @if (errorMessage()) {
          <p class="alert alert-error">{{ errorMessage() }}</p>
          <a routerLink="/login" class="btn btn-primary btn-block">Quay lại đăng nhập</a>
        } @else {
          <p class="auth-subtitle">Đang hoàn tất đăng nhập Google...</p>
        }
      </div>
    </div>
  `,
  styles: `
    .auth-card--center {
      text-align: center;
    }
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.authService.completeOAuthSignIn();
      await this.router.navigate(['/spaced-repetition']);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Đăng nhập Google thất bại');
    }
  }
}
