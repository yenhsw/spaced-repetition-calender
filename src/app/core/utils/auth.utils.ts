import { TranslationKey } from '../i18n/translations';
import { TranslationService } from '../i18n/translation.service';

/** Internal auth email for Supabase (username-based login). */
const AUTH_EMAIL_DOMAIN = 'spaced-rep.app';

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function usernameToAuthEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

export function isValidUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  return normalized.length >= 3 && /^[a-z0-9_]+$/.test(normalized);
}

export function mapAuthErrorMessage(err: unknown, i18n: TranslationService): string {
  if (!(err instanceof Error)) return i18n.t('auth.error.generic');

  const msg = err.message.toLowerCase();

  const rules: Array<{ match: (m: string) => boolean; key: TranslationKey }> = [
    {
      match: (m) => m.includes('user already registered') || m.includes('already been registered'),
      key: 'auth.error.usernameTaken',
    },
    { match: (m) => m.includes('invalid login credentials'), key: 'auth.error.invalidCredentials' },
    {
      match: (m) => m.includes('email_address_invalid') || m.includes('is invalid'),
      key: 'auth.error.invalidUsername',
    },
    {
      match: (m) => m.includes('could not find the table') || m.includes('pgrst204'),
      key: 'auth.error.dbNotSetup',
    },
    {
      match: (m) => m.includes('rate limit') || m.includes('over_email_send_rate_limit'),
      key: 'auth.error.rateLimit',
    },
  ];

  for (const rule of rules) {
    if (rule.match(msg)) return i18n.t(rule.key);
  }

  return err.message;
}
