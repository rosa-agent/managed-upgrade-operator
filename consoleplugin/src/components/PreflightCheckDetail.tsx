import * as React from 'react';
import {
  ExpandableSection, List, ListItem, Alert, Label,
  DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
} from '@patternfly/react-core';
import { type PreflightCheckResult, type CheckResult } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props { checks: PreflightCheckResult[]; }

const SEVERITY: Record<CheckResult, number> = {
  Error:    0,
  Failed:   1,
  Warning:  2,
  Unknown:  3,
  Passed:   4,
  Skipped:  5,
  TimedOut: 6,
};

const OWNER_LABEL: Record<string, { color: 'gold' | 'blue'; text: string }> = {
  'customer':     { color: 'gold', text: 'Customer action required' },
  'service-team': { color: 'blue', text: 'Service team action required' },
};

const ACTION_VARIANT: Partial<Record<CheckResult, 'danger' | 'warning'>> = {
  Failed: 'danger',
  Error:  'danger',
  Warning: 'warning',
};

export const PreflightCheckDetail: React.FC<Props> = ({ checks }) => {
  const sorted = [...checks].sort(
    (a, b) => (SEVERITY[a.result] ?? 3) - (SEVERITY[b.result] ?? 3)
  );

  return (
    <DescriptionList isHorizontal columnModifier={{ default: '1Col' }}>
      {sorted.map((c) => {
        const ownerCfg = c.owner ? OWNER_LABEL[c.owner] : null;
        const actionVariant = ACTION_VARIANT[c.result] ?? 'warning';
        return (
          <DescriptionListGroup key={c.name}>
            <DescriptionListTerm>
              <strong>{c.name}</strong>
              {c.description && (
                <div style={{ fontSize: 'var(--pf-v5-global--FontSize--sm)', color: 'var(--pf-v5-global--Color--200)', marginTop: 2 }}>
                  {c.description}
                </div>
              )}
            </DescriptionListTerm>
            <DescriptionListDescription>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <StatusBadge result={c.result} />
                {ownerCfg && (c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning') && (
                  <Label color={ownerCfg.color} isCompact>{ownerCfg.text}</Label>
                )}
              </div>
              {c.execution.summary && (
                <p style={{ marginTop: 4, marginBottom: 0 }}>{c.execution.summary}</p>
              )}
              {c.execution.findings && c.execution.findings.length > 0 && (
                <ExpandableSection toggleText={`${c.execution.findings.length} finding(s)`} style={{ marginTop: 4 }}>
                  <List>
                    {c.execution.findings.map((f, i) => <ListItem key={i}>{f}</ListItem>)}
                  </List>
                </ExpandableSection>
              )}
              {c.action && (
                <Alert variant={actionVariant} isInline title="Recommended action" style={{ marginTop: 8 }}>
                  {c.action}
                </Alert>
              )}
              {c.execution.error && (
                <Alert variant="danger" isInline title="Check error" style={{ marginTop: 8 }}>
                  {c.execution.error}
                </Alert>
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
        );
      })}
    </DescriptionList>
  );
};
