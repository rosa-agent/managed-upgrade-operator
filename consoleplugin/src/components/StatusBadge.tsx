import * as React from 'react';
import {
  CheckCircleIcon, ExclamationTriangleIcon, TimesCircleIcon,
  ExclamationCircleIcon, BanIcon, ClockIcon, QuestionCircleIcon,
} from '@patternfly/react-icons';
import { type CheckResult } from '../types';

// Inline-styled badge — does not depend on PF CSS class loading.
// PF's pf-m-red / pf-m-green etc. are not guaranteed to load in
// the console plugin's iframe context.

interface Config {
  label: string;
  bg: string;
  fg: string;
  border: string;
  icon: React.ReactNode;
}

const CONFIG: Record<CheckResult, Config> = {
  Passed:   { label: 'Passed',    bg: 'rgba(23,130,48,0.18)',   fg: '#5ba352', border: 'rgba(23,130,48,0.4)',   icon: <CheckCircleIcon /> },
  Failed:   { label: 'Failed',    bg: 'rgba(201,25,11,0.18)',   fg: '#c9190b', border: 'rgba(201,25,11,0.4)',   icon: <TimesCircleIcon /> },
  Error:    { label: 'Error',     bg: 'rgba(201,97,11,0.18)',   fg: '#c95f0b', border: 'rgba(201,97,11,0.4)',   icon: <ExclamationCircleIcon /> },
  Warning:  { label: 'Warning',   bg: 'rgba(240,171,0,0.18)',   fg: '#c58c00', border: 'rgba(240,171,0,0.4)',   icon: <ExclamationTriangleIcon /> },
  Skipped:  { label: 'Skipped',   bg: 'rgba(106,110,115,0.18)', fg: '#6a6e73', border: 'rgba(106,110,115,0.4)', icon: <BanIcon /> },
  TimedOut: { label: 'Timed Out', bg: 'rgba(201,97,11,0.18)',   fg: '#c95f0b', border: 'rgba(201,97,11,0.4)',   icon: <ClockIcon /> },
  Unknown:  { label: 'Unknown',   bg: 'rgba(106,110,115,0.18)', fg: '#6a6e73', border: 'rgba(106,110,115,0.4)', icon: <QuestionCircleIcon /> },
};

interface Props { result: CheckResult; }

export const StatusBadge: React.FC<Props> = ({ result }) => {
  const { label, bg, fg, border, icon } = CONFIG[result] ?? CONFIG.Unknown;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 10px',
      borderRadius: 20,
      background: bg,
      color: fg,
      border: `1px solid ${border}`,
      fontWeight: 600,
      fontSize: 13,
      whiteSpace: 'nowrap',
    }}>
      {icon}
      {label}
    </span>
  );
};
