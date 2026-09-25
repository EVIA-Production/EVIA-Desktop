import React from 'react';
import { SFSymbol } from './sf-symbols';
import { i18n } from '../i18n/i18n';
import { openUpgrade, trialLimitMessage, upgradeLabel, type TrialLimitNotice } from '../lib/trial-limit';

/**
 * A trial limit, shown in place in the Listen panel.
 *
 * Built on the preset notice's status alert (same HIG pattern: symbol, one
 * line, no modal), with one action, because unlike a preset notice there is
 * something to do: upgrade. It has no dismiss control; the limit does not go
 * away by hiding it.
 */
interface TrialLimitNoticeViewProps {
  notice: TrialLimitNotice;
}

const WarningGlyph: React.FC = () => (
  <svg
    className="taylos-status-alert__glyph"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 1.9 15 14H1L8 1.9Z" />
    <path d="M8 6.4v3.1" />
    <circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
  </svg>
);

const t = (key: string) => i18n.t(key);

export const TrialLimitNoticeView: React.FC<TrialLimitNoticeViewProps> = ({ notice }) => (
  <div
    className="taylos-status-alert taylos-status-alert--caution taylos-status-alert--compact taylos-status-alert--with-action"
    role="status"
    aria-live="polite"
    data-trial-limit={notice.code}
  >
    <span className="taylos-status-alert__symbol" aria-hidden="true">
      <SFSymbol name="exclamationmark.triangle" pointSize={13} fallback={<WarningGlyph />} />
    </span>
    <div className="taylos-status-alert__text">
      <span className="taylos-status-alert__title">{trialLimitMessage(notice, t)}</span>
    </div>
    <button
      type="button"
      className="taylos-status-alert__action"
      onClick={() => openUpgrade(notice)}
    >
      {upgradeLabel(t)}
    </button>
  </div>
);

export default TrialLimitNoticeView;
