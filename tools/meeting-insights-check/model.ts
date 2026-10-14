export const DEMO_LIVE_THINKING_MS = 10;
export const DEMO_POST_THINKING_MS = 10;
export type DemoScript = { suggestions?: string[] };
export function getDemoAskResponse() { return null; }
export function buildDemoInsights() {
  const short = new URLSearchParams(location.search).get('size') === 'short';
  const empty = new URLSearchParams(location.search).get('size') === 'empty';
  return {
    prospect_info: empty ? [] : short ? ['Kunde prüft technische Risiken.'] : [
      'Kunde prüft technische Risiken.',
      'Anlagehorizont: 20 bis 25 Jahre.',
      'Kunde fordert belegte Projektannahmen.'
    ],
    sales_analysis: empty ? [] : short ? ['Zuerst den Unterschied erklären.'] : [
      'Degradation und Verschmutzung getrennt erklären.',
      'Konkrete Projektwerte fehlen noch.',
      'Projektannahmen prüfen und schriftlich senden.'
    ],
    actions: empty ? ['💬 Was soll ich als Nächstes sagen?'] : [
      '💬 Was soll ich als Nächstes sagen?',
      '❓ Unterschied erklären',
      '📊 Projektannahmen prüfen'
    ], session_state: 'during', stub: false,
  };
}
