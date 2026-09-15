import React from 'react';
import { i18n } from '../i18n/i18n';
import { presetNoticeCopy, type PresetNotice, type PresetNoticeKind } from '../lib/preset-notice';
import { SFSymbol, type SFSymbolName } from './sf-symbols';

/**
 * The preset notice, built the way macOS surfaces a non-blocking problem.
 *
 * HIG (Alerts): "Avoid using an alert merely to provide information ... prefer
 * finding an alternative way to communicate it within the relevant context"
 * and "a nonintrusive label that describes the problem". TipKit's inline tip
 * is the concrete pattern: symbol, short title, and a close control in the
 * trailing corner. Here the close control appears on hover, as macOS reveals
 * secondary controls, and stays reachable by keyboard.
 *
 * One header line per state. A preset cannot be changed during a call and the
 * notice only exists during one, so there is nothing to act on here - the
 * header names the state. Only the mismatch keeps a second line, because
 * which preset this call actually runs on is information the rep cannot get
 * anywhere else.
 *
 * Symbols: the real SF Symbols, Semibold, one per state - the subject glyph
 * for a preset is a document, and the variant says what is wrong with it:
 *
 *   missing      text.document           the preset, as such
 *   blank        document                a page with nothing on it
 *   mismatch     document.on.document    another one is active
 *   unavailable  exclamationmark.triangle degraded state, same as "No Connection"
 *   dismiss      xmark
 */
interface PresetNoticeViewProps {
  notice: PresetNotice;
  onDismiss?: () => void;
}

const SYMBOL_FOR_KIND: Record<PresetNoticeKind, SFSymbolName> = {
  missing: 'text.document',
  blank: 'document',
  mismatch: 'document.on.document',
  unavailable: 'exclamationmark.triangle',
};

/* Generic hairline glyphs for non-Apple platforms, where the SF outlines
 * must not be drawn (see sf-symbols.tsx). Same silhouettes, own drawing. */
const FallbackGlyph: React.FC<{ name: SFSymbolName }> = ({ name }) => {
  const common = {
    className: 'taylos-status-alert__glyph',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'exclamationmark.triangle':
      return (
        <svg {...common}>
          <path d="M8 1.9 15 14H1L8 1.9Z" />
          <path d="M8 6.4v3.1" />
          <circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'document.on.document':
      return (
        <svg {...common}>
          <path d="M6.2 4.2h4.3l2.6 2.6v6.4a.8.8 0 0 1-.8.8H6.2a.8.8 0 0 1-.8-.8V5a.8.8 0 0 1 .8-.8Z" />
          <path d="M10.4 4.2v2.7h2.7" />
          <path d="M3.4 11.2V2.7a.8.8 0 0 1 .8-.8h4.9" />
        </svg>
      );
    case 'xmark':
      return (
        <svg {...common} strokeWidth={1.6}>
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M4.2 1.9h5.1l3.2 3.2v8.2a.8.8 0 0 1-.8.8H4.2a.8.8 0 0 1-.8-.8V2.7a.8.8 0 0 1 .8-.8Z" />
          <path d="M9.3 1.9v3.2h3.2" />
        </svg>
      );
    case 'text.document':
    default:
      return (
        <svg {...common}>
          <path d="M4.2 1.9h5.1l3.2 3.2v8.2a.8.8 0 0 1-.8.8H4.2a.8.8 0 0 1-.8-.8V2.7a.8.8 0 0 1 .8-.8Z" />
          <path d="M9.3 1.9v3.2h3.2" />
          <path d="M5.6 8.4h4.8M5.6 10.9h3.2" />
        </svg>
      );
  }
};

export const PresetNoticeView: React.FC<PresetNoticeViewProps> = ({ notice, onDismiss }) => {
  const copy = presetNoticeCopy(notice, (key) => i18n.t(key));
  const symbol = SYMBOL_FOR_KIND[notice.kind];
  const dismissLabel = i18n.t('overlay.listen.presetNotice.dismiss');
  return (
    <div
      className={`taylos-status-alert taylos-status-alert--${copy.tone}${copy.detail ? '' : ' taylos-status-alert--compact'}`}
      role="status"
      aria-live="polite"
      data-preset-notice={notice.kind}
    >
      <span className="taylos-status-alert__symbol" aria-hidden="true">
        <SFSymbol name={symbol} pointSize={13} fallback={<FallbackGlyph name={symbol} />} />
      </span>
      <div className="taylos-status-alert__text">
        <span className="taylos-status-alert__title">{copy.title}</span>
        {copy.detail && <span className="taylos-status-alert__detail">{copy.detail}</span>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="taylos-status-alert__dismiss"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <SFSymbol name="xmark" pointSize={11} fallback={<FallbackGlyph name="xmark" />} />
        </button>
      )}
    </div>
  );
};

export default PresetNoticeView;
