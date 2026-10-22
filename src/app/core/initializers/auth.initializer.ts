import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export function authInitializer(): () => Promise<void> {
  const authService = inject(AuthService);
  return () => authService.init();
}
