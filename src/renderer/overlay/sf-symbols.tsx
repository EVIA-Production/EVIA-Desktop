/**
 * Five SF Symbols, as the exact Semibold outlines from Apple's symbol font.
 *
 * Why outlines and not the system font: Chromium on macOS does not expose the
 * SF Symbols private-use glyphs through `-apple-system` (U+10023F renders as
 * the missing-glyph box - verified 2026-09-15 in the app's own renderer), so a
 * symbol in the overlay can only be drawn from its outline. These were taken
 * from `.SF Symbols Fallback` (SF Symbols 7.2, font build 21.1d1e1) at the
 * Semibold instance (wght 590.8) - the weight that pairs with the notice's
 * emphasised 590 title, which is how macOS pairs a symbol with its label.
 * Medium scale, tight bounding box, y flipped, font units (2048/em).
 *
 * Licence: Apple restricts SF Symbols to software for Apple platforms. The
 * `SFSymbol` component therefore only draws these on macOS (`data-platform`
 * on <html>) and falls back to the generic hairline glyphs elsewhere; the
 * outlines are still bytes in the shared renderer bundle - move them to a
 * macOS-only resource if strict compliance is wanted.
 */
import React from 'react';

export type SFSymbolName =
  | 'text.document'
  | 'document'
  | 'document.on.document'
  | 'exclamationmark.triangle'
  | 'xmark';

interface SymbolOutline {
  codepoint: string;
  /** Tight bounding box in font units. */
  width: number;
  height: number;
  d: string;
}

export const UNITS_PER_EM = 2048;

export const SF_SYMBOL_OUTLINES: Record<SFSymbolName, SymbolOutline> = {
  'text.document': {
    codepoint: 'U+10023F',
    width: 1739,
    height: 2181,
    d: 'M1217 1230H504C466 1230 438 1258 438 1294C438 1331 466 1360 504 1360H1217C1254 1360 1282 1331 1282 1294C1282 1258 1254 1230 1217 1230ZM1217 1555H504C466 1555 438 1584 438 1621C438 1657 466 1684 504 1684H1217C1254 1684 1282 1657 1282 1621C1282 1584 1254 1555 1217 1555ZM335 2181H1403C1623 2181 1739 2063 1739 1842V935C1739 789 1719 719 1627 625L1121 113C1032 22 958 0 823 0H336C117 0 0 118 0 339V1842C0 2063 116 2180 336 2180ZM358 1957C266 1957 222 1910 222 1822V358C222 271 266 223 358 223H770V746C770 902 845 977 1001 977H1516V1823C1516 1911 1472 1958 1380 1958ZM1020 788C977 788 959 769 959 727V248L1491 789Z',
  },
  'document': {
    codepoint: 'U+100237',
    width: 1739,
    height: 2181,
    d: 'M335 2181H1403C1623 2181 1739 2063 1739 1842V935C1739 789 1719 719 1627 625L1121 113C1032 22 958 0 823 0H336C117 0 0 118 0 339V1842C0 2063 116 2180 336 2180ZM358 1957C266 1957 222 1910 222 1822V358C222 271 266 223 358 223H770V746C770 902 845 977 1001 977H1516V1823C1516 1911 1472 1958 1380 1958ZM1020 788C977 788 959 769 959 727V248L1491 789Z',
  },
  'document.on.document': {
    codepoint: 'U+100241',
    width: 2106,
    height: 2564,
    d: 'M501 583H724V355C724 268 768 220 860 220H1262V672C1262 802 1334 874 1463 874H1884V1681C1884 1769 1839 1817 1747 1817H1567V2040H1770C1989 2040 2106 1922 2106 1702V924C2106 786 2077 698 1995 614L1501 111C1423 32 1329 0 1208 0H838C619 0 502 118 502 339ZM1440 650V307L1826 699H1488C1454 699 1440 684 1440 650ZM0 2226C0 2447 116 2564 336 2564H1269C1489 2564 1605 2446 1605 2226V1465C1605 1327 1587 1259 1500 1171L965 629C881 544 808 524 681 524H336C117 524 0 641 0 862ZM223 2207V881C223 795 267 747 359 747H650V1269C650 1426 726 1501 881 1501H1382V2208C1382 2296 1337 2344 1246 2344H358C266 2344 222 2296 222 2208ZM900 1312C858 1312 839 1293 839 1250V786L1357 1311Z',
  },
  'exclamationmark.triangle': {
    codepoint: 'U+1001FE',
    width: 2130,
    height: 1935,
    d: 'M295 1935H1838C2016 1935 2130 1804 2130 1644C2130 1594 2116 1542 2089 1495L1316 147C1260 49 1164 0 1065 0C966 0 869 49 814 146L41 1494C13 1541 0 1592 0 1642C0 1802 114 1933 292 1933ZM321 1721C263 1721 228 1676 228 1625C228 1610 231 1590 240 1573L983 272C1000 242 1032 229 1063 229C1093 229 1124 242 1141 272L1885 1575C1894 1592 1898 1611 1898 1626C1898 1677 1862 1722 1805 1722ZM1064 1230C1123 1230 1157 1197 1159 1135L1174 681C1177 618 1129 573 1062 573C995 573 949 617 952 680L967 1135C969 1196 1004 1230 1064 1230ZM1064 1566C1133 1566 1188 1519 1188 1452C1188 1385 1134 1338 1065 1338C996 1338 941 1385 941 1452C941 1518 996 1566 1065 1566Z',
  },
  'xmark': {
    codepoint: 'U+100184',
    width: 1630.3,
    height: 1629.8,
    d: 'M1410.5 36 35.5 1411C-11.5 1458 -12.5 1543 36.5 1592C86.5 1641 172.5 1640 219.5 1593L1594.5 218C1642.5 170 1642.5 87 1592.5 38C1542.5 -12 1460.5 -13 1411.5 37ZM1594.5 1411 219.5 36C172.5 -11 86.5 -13 37.5 38C-11.5 88 -10.5 172 36.5 219L1411.5 1594C1459.5 1642 1543.5 1642 1592.5 1592C1641.5 1542 1641.5 1459 1593.5 1410Z',
  },
};

export function isApplePlatform(): boolean {
  if (typeof document === 'undefined') return false;
  const platform = document.documentElement.dataset.platform;
  if (platform) return platform === 'darwin';
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
}

/** Pixel size of a symbol drawn at `pointSize`, as the system would draw it. */
export function symbolPixelSize(name: SFSymbolName, pointSize: number): { width: number; height: number } {
  const s = SF_SYMBOL_OUTLINES[name];
  const scale = pointSize / UNITS_PER_EM;
  return { width: s.width * scale, height: s.height * scale };
}

interface SFSymbolProps {
  name: SFSymbolName;
  /** Text point size the symbol accompanies; the glyph scales like the system's medium scale. */
  pointSize?: number;
  className?: string;
  /** Rendered when the exact outline must not be used (non-Apple platform). */
  fallback: React.ReactNode;
}

export const SFSymbol: React.FC<SFSymbolProps> = ({ name, pointSize = 13, className, fallback }) => {
  if (!isApplePlatform()) return <>{fallback}</>;
  const s = SF_SYMBOL_OUTLINES[name];
  const { width, height } = symbolPixelSize(name, pointSize);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${s.width} ${s.height}`}
      width={width.toFixed(2)}
      height={height.toFixed(2)}
      aria-hidden="true"
      focusable="false"
    >
      <path d={s.d} fill="currentColor" />
    </svg>
  );
};
