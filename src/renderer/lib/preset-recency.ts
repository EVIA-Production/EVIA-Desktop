type Preset = { id: string | number; is_active?: boolean };
const storageKey = (identity: string) => `taylos.preset-recency:${encodeURIComponent(identity)}`;

export function readPresetRecency(identity: string): string[] {
  if (!identity) return [];
  try {
    const ids = JSON.parse(localStorage.getItem(storageKey(identity)) || '[]');
    return Array.isArray(ids) ? [...new Set<string>(ids.filter((id: unknown) => typeof id === 'string'))].slice(0, 200) : [];
  } catch { return []; }
}

export function rememberPresetUse(identity: string, id: string | number): void {
  if (!identity) return;
  const next = [String(id), ...readPresetRecency(identity).filter(item => item !== String(id))].slice(0, 200);
  try { localStorage.setItem(storageKey(identity), JSON.stringify(next)); } catch { /* The active row still comes first. */ }
}

export function orderPresets<T extends Preset>(presets: T[], recency: string[]): T[] {
  const rank = new Map(recency.map((id, index) => [String(id), index]));
  return presets.map((preset, index) => ({preset, index})).sort((a, b) =>
    Number(Boolean(b.preset.is_active)) - Number(Boolean(a.preset.is_active))
    || (rank.get(String(a.preset.id)) ?? Infinity) - (rank.get(String(b.preset.id)) ?? Infinity)
    || a.index - b.index
  ).map(item => item.preset);
}
