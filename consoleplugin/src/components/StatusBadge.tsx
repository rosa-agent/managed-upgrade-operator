import * as React from 'react';
import { Label } from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationTriangleIcon, TimesCircleIcon, QuestionCircleIcon, BanIcon } from '@patternfly/react-icons';
import { type CheckResult } from '../types';

interface Props { result: CheckResult; }

const CONFIG: Record<CheckResult, { color: 'green' | 'orange' | 'red' | 'grey'; icon: React.ReactNode; label: string }> = {
  Passed:   { color: 'green',  icon: <CheckCircleIcon />,        label: 'Passed'    },
  Warning:  { color: 'orange', icon: <ExclamationTriangleIcon />, label: 'Warning'   },
  Failed:   { color: 'red',    icon: <TimesCircleIcon />,         label: 'Failed'    },
  Error:    { color: 'red',    icon: <TimesCircleIcon />,         label: 'Error'     },
  Skipped:  { color: 'grey',   icon: <BanIcon />,                 label: 'Skipped'   },
  TimedOut: { color: 'grey',   icon: <QuestionCircleIcon />,      label: 'Timed Out' },
  Unknown:  { color: 'grey',   icon: <QuestionCircleIcon />,      label: 'Unknown'   },
};

export const StatusBadge: React.FC<Props> = ({ result }) => {
  const { color, icon, label } = CONFIG[result] ?? CONFIG.Unknown;
  return <Label color={color} icon={icon}>{label}</Label>;
};
