import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { guestGuard } from './core/guards/guest.guard';
import { AppShellComponent } from './shared/components/app-shell/app-shell.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
    canActivate: [guestGuard],
  },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'spaced-repetition', pathMatch: 'full' },
      {
        path: 'spaced-repetition',
        loadComponent: () =>
          import('./features/calendar/study-calendar/study-calendar.component').then(
            (m) => m.StudyCalendarComponent,
          ),
      },
      { path: 'calendar', redirectTo: 'spaced-repetition', pathMatch: 'full' },
      {
        path: 'settings/notifications',
        loadComponent: () =>
          import('./features/settings/notification-settings/notification-settings.component').then(
            (m) => m.NotificationSettingsComponent,
          ),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          {
            path: 'users',
            loadComponent: () =>
              import('./features/admin/admin-dashboard/admin-dashboard.component').then(
                (m) => m.AdminDashboardComponent,
              ),
          },
          {
            path: 'users/:userId/calendar',
            loadComponent: () =>
              import('./features/admin/user-calendar/user-calendar.component').then(
                (m) => m.UserCalendarComponent,
              ),
          },
          {
            path: 'users/:userId/notifications',
            loadComponent: () =>
              import('./features/settings/notification-settings/notification-settings.component').then(
                (m) => m.NotificationSettingsComponent,
              ),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: 'spaced-repetition' },
];
