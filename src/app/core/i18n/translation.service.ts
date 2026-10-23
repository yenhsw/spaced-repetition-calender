import { Injectable, signal } from '@angular/core';
import { AppLocale, DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from './locale.enum';
import { TRANSLATIONS, TranslationKey, TranslationParams } from './translations';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly localeSignal = signal<AppLocale>(this.readStoredLocale());

  readonly locale = this.localeSignal.asReadonly();

  t(key: TranslationKey, params?: TranslationParams): string {
    let text = TRANSLATIONS[this.localeSignal()][key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
    }
    return text;
  }

  setLocale(locale: AppLocale): void {
    this.localeSignal.set(locale);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  }

  toggleLocale(): void {
    this.setLocale(this.localeSignal() === 'vi' ? 'en' : 'vi');
  }

  switchLabel(): TranslationKey {
    return this.localeSignal() === 'vi' ? 'lang.switchToEn' : 'lang.switchToVi';
  }

  localeBadge(): string {
    return this.localeSignal() === 'vi' ? 'EN' : 'VI';
  }

  dateLocale(): string {
    return this.localeSignal() === 'vi' ? 'vi-VN' : 'en-GB';
  }

  private readStoredLocale(): AppLocale {
    if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en' || stored === 'vi' ? stored : DEFAULT_LOCALE;
  }
}
