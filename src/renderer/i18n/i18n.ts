import enTranslations from './en.json';
import deTranslations from './de.json';

type Language = 'en' | 'de';
type Translations = typeof enTranslations;

class I18n {
  private currentLanguage: Language = 'en';
  private translations: Record<Language, Translations> = {
    en: enTranslations,
    de: deTranslations,
  };

  private detectInitialLanguage(): Language {
    const stored = localStorage.getItem('evia_language') as Language | null;
    if (stored === 'en' || stored === 'de') {
      return stored;
    }

    const browserLanguage =
      (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || 'en';
    const normalized = browserLanguage.toLowerCase();
    if (normalized.startsWith('de')) {
      return 'de';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
    return 'en';
  }

  setLanguage(lang: Language): void {
    this.currentLanguage = lang;
    localStorage.setItem('evia_language', lang);
  }

  getLanguage(): Language {
    const stored = localStorage.getItem('evia_language') as Language;
    if (stored && (stored === 'en' || stored === 'de')) {
      this.currentLanguage = stored;
    } else {
      this.currentLanguage = this.detectInitialLanguage();
      localStorage.setItem('evia_language', this.currentLanguage);
    }
    return this.currentLanguage;
  }

  t(key: string): string {
    const keys = key.split('.');
    let value: any = this.translations[this.currentLanguage];
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`[i18n] Translation key not found: ${key}`);
        return key;
      }
    }
    
    return typeof value === 'string' ? value : key;
  }
}

export const i18n = new I18n();
export default i18n;
