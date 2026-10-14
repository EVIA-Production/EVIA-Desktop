import { useLayoutEffect, useRef } from 'react';

export function usePresetReorder(order: string, visible: boolean) {
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { top: number; left: number }>());
  const animations = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !visible) { previous.current.clear(); return; }
    const current = new Map<string, { top: number; left: number }>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parent = element.getBoundingClientRect();
    for (const row of element.querySelectorAll<HTMLElement>('[data-preset-id]')) {
      const id = row.dataset.presetId!;
      animations.current.get(id)?.cancel();
      const rect = row.getBoundingClientRect();
      const position = { top: rect.top - parent.top + element.scrollTop, left: rect.left - parent.left + element.scrollLeft };
      current.set(id, position);
      const before = previous.current.get(id);
      if (!reduced && before && typeof row.animate === 'function') {
        const x = before.left - position.left, y = before.top - position.top;
        if (Math.abs(x) > .5 || Math.abs(y) > .5) {
          animations.current.set(id, row.animate([
            { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
          ], { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
        }
      }
    }
    previous.current = current;
    return () => { animations.current.forEach(animation => animation.cancel()); animations.current.clear(); };
  }, [order, visible]);
  return list;
}
