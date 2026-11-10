import * as React from 'react';
import { Label } from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationTriangleIcon, TimesCircleIcon, QuestionCircleIcon } from '@patternfly/react-icons';
import { type CheckResult } from '../types';

interface Props { result: CheckResult; }

const config: Record<CheckResult, { color: 'green' | 'orange' | 'red' | 'grey'; icon: React.ReactNode }> = {
  Passed:   { color: 'green',  icon: <CheckCircleIcon /> },
  Warning:  { color: 'orange', icon: <ExclamationTriangleIcon /> },
  Failed:   { color: 'red',    icon: <TimesCircleIcon /> },
  Error:    { color: 'red',    icon: <TimesCircleIcon /> },
  Skipped:  { color: 'grey',   icon: <QuestionCircleIcon /> },
  TimedOut: { color: 'grey',   icon: <QuestionCircleIcon /> },
  Unknown:  { color: 'grey',   icon: <QuestionCircleIcon /> },
};

export const StatusBadge: React.FC<Props> = ({ result }) => {
  const { color, icon } = config[result] ?? config.Unknown;
  return <Label color={color} icon={icon}>{result}</Label>;
};
