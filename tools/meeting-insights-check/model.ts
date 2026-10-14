export const DEMO_LIVE_THINKING_MS = 10;
export const DEMO_POST_THINKING_MS = 10;
export function buildDemoInsights() {
  const short = new URLSearchParams(location.search).get('size') === 'short';
  return {
    prospect_info: ['Der Kunde möchte Degradation und Verschmutzungsverluste verstehen.'],
    sales_analysis: short ? ['Zuerst den Unterschied erklären.'] : [
      'Degradation und Verschmutzung getrennt erklären, bevor Sie weitere Fragen stellen.',
      'Der Kunde hat bereits 20 bis 25 Jahre genannt. Nicht erneut nach der Laufzeit fragen.',
      'Die konkreten Projektannahmen sind noch nicht belegt. Keine Prozentwerte erfinden.',
      'Die Prüfung der Annahmen und eine schriftliche Antwort nach dem Gespräch wurden zugesagt.',
      'Die Frage bezieht sich auf die vorgelegte Kalkulation. Nicht erneut fragen, welche Kalkulation gemeint ist.',
      'Eine allgemeine Erklärung ersetzt keinen projektspezifischen Nachweis.'
    ],
    actions: ['💬 Was soll ich als Nächstes sagen?'], session_state: 'during', stub: false,
  };
}
