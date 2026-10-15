export type { AskQuerySource } from '../../src/renderer/lib/evia-ask-stream';

// Local layout fixture: exercise the real Ask renderer without any provider call.
export function streamAsk() {
  let delta = (_text: string) => {};
  let done = () => {};
  let timer: ReturnType<typeof setInterval>;
  const chunks = [
    'Degradation ist der dauerhafte Leistungsverlust der Module. ',
    'Verschmutzungsverluste entstehen durch Schmutz auf der Moduloberfläche. ',
    'Sie können durch Reinigung teilweise vermieden werden. ',
    'Beide Effekte müssen getrennt in die Ertragsprognose eingehen. ',
    'Die konkreten Projektwerte liegen hier noch nicht vor. ',
    'Ich prüfe die Annahmen und sende Ihnen die Belege nach dem Gespräch schriftlich.',
  ];
  let index = 0;
  timer = setInterval(() => {
    if (index < chunks.length) delta(chunks[index++]);
    else { clearInterval(timer); done(); }
  }, 600);
  return {
    onDelta(callback: typeof delta) { delta = callback; },
    onReplace() {},
    onDone(callback: typeof done) { done = callback; },
    onError() {},
    abort() { clearInterval(timer); },
  };
}
