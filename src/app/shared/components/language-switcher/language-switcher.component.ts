import { Component, inject } from '@angular/core';
import { TranslationService } from '../../../core/i18n/translation.service';

@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [],
  template: `
    <button
      type="button"
      class="lang-switch"
      (click)="i18n.toggleLocale()"
      [attr.aria-label]="i18n.t(i18n.switchLabel())"
      [title]="i18n.t(i18n.switchLabel())"
    >
      <span class="lang-switch__icon" aria-hidden="true">🌐</span>
      <span class="lang-switch__badge">{{ i18n.localeBadge() }}</span>
    </button>
  `,
})
export class LanguageSwitcherComponent {
  protected readonly i18n = inject(TranslationService);
}

