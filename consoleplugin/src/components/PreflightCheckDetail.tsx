import * as React from 'react';
import {
  DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
  Label, List, ListItem,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { type UpgradePreflightCheck, type PreflightCheckResult, type CheckResult } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props { pfc: UpgradePreflightCheck; }

const DESCRIPTION_ANNOTATION = 'preflight.managed.openshift.io/description';

const SEVERITY: Record<CheckResult, number> = {
  Error: 0, Failed: 1, Warning: 2, Unknown: 3, Passed: 4, Skipped: 5, TimedOut: 6,
};

// Split PascalCase identifiers into readable words: "CriticalAlerts" → "Critical Alerts"
const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

const fmt = (ts?: string) => ts ? new Date(ts).toLocaleString() : '—';

const elapsed = (start?: string, end?: string): string => {
  if (!start) return '—';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const OWNER_LABEL: Record<string, string> = {
  'customer':     'Customer action required',
  'service-team': 'Red Hat action required',
};

const CheckRowDetail: React.FC<{ c: PreflightCheckResult }> = ({ c }) => {
  const hasContent = c.execution.summary || c.action || c.execution.error ||
    (c.execution.findings && c.execution.findings.length > 0);
  if (!hasContent) return <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>No additional details.</span>;
  return (
    <div style={{ padding: '8px 0' }}>
      {c.execution.summary && <p style={{ margin: '0 0 8px' }}>{c.execution.summary}</p>}
      {c.execution.error && (
        <p style={{ margin: '0 0 8px', color: 'var(--pf-v5-global--palette--red-200)' }}>
          <strong>Error:</strong> {c.execution.error}
        </p>
      )}
      {c.execution.findings && c.execution.findings.length > 0 && (
        <>
          <strong>Findings:</strong>
          <List style={{ marginTop: 4 }}>
            {c.execution.findings.map((f, i) => <ListItem key={i}>{f}</ListItem>)}
          </List>
        </>
      )}
      {c.action && (
        <p style={{ margin: '8px 0 0' }}>
          <strong>Action required:</strong> {c.action}
        </p>
      )}
    </div>
  );
};

export const PreflightCheckDetail: React.FC<Props> = ({ pfc }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (name: string) => setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const description = pfc.metadata?.annotations?.[DESCRIPTION_ANNOTATION];
  const s = pfc.status;
  const sorted = [...(s?.checks ?? [])].sort(
    (a, b) => (SEVERITY[a.result] ?? 3) - (SEVERITY[b.result] ?? 3)
  );

  const platformLabel = pfc.spec.type === 'OSD'
    ? 'OpenShift Dedicated'
    : pfc.spec.type === 'ARO'
    ? 'Azure Red Hat OpenShift'
    : pfc.spec.type;

  return (
    <div style={{ padding: '16px 0' }}>
      {/* ── Metadata / spec ── */}
      <DescriptionList isHorizontal columnModifier={{ default: '2Col' }} style={{ marginBottom: 24 }}>
        <DescriptionListGroup>
          <DescriptionListTerm>Target version</DescriptionListTerm>
          <DescriptionListDescription>{pfc.spec.desired.version}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Channel</DescriptionListTerm>
          <DescriptionListDescription>{pfc.spec.desired.channel}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Platform</DescriptionListTerm>
          <DescriptionListDescription>{platformLabel}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Overall result</DescriptionListTerm>
          <DescriptionListDescription>
            {s?.overallResult ? <StatusBadge result={s.overallResult} /> : '—'}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Started</DescriptionListTerm>
          <DescriptionListDescription>{fmt(s?.startedAt)}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Completed</DescriptionListTerm>
          <DescriptionListDescription>{fmt(s?.completedAt)}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Duration</DescriptionListTerm>
          <DescriptionListDescription>{elapsed(s?.startedAt, s?.completedAt)}</DescriptionListDescription>
        </DescriptionListGroup>
        {description && (
          <DescriptionListGroup>
            <DescriptionListTerm>Description</DescriptionListTerm>
            <DescriptionListDescription>{description}</DescriptionListDescription>
          </DescriptionListGroup>
        )}
      </DescriptionList>

      {/* ── Checks table ── */}
      {sorted.length > 0 && (
        <Table aria-label="Individual checks" variant="compact">
          <Thead>
            <Tr>
              <Th />
              <Th>Check</Th>
              <Th>Result</Th>
              <Th>Status</Th>
              <Th>Started</Th>
              <Th>Elapsed</Th>
              <Th>Owner</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((c, rowIndex) => {
              const isExpanded = !!expanded[c.name];
              const ownerLabel = c.owner ? OWNER_LABEL[c.owner] : null;
              const stateLabel = {
                Completed: 'Completed',
                Error: 'Error',
                Skipped: 'Skipped',
                TimedOut: 'Timed Out',
              }[c.execution.state] ?? c.execution.state;

              return (
                <React.Fragment key={c.name}>
                  <Tr>
                    <Td
                      expand={{ isExpanded, onToggle: () => toggle(c.name), rowIndex }}
                    />
                    <Td>
                      <div><strong>{humanize(c.name)}</strong></div>
                      {c.description && (
                        <div style={{ fontSize: 'var(--pf-v5-global--FontSize--sm)', color: 'var(--pf-v5-global--Color--200)' }}>
                          {c.description}
                        </div>
                      )}
                    </Td>
                    <Td><StatusBadge result={c.result} /></Td>
                    <Td>{stateLabel}</Td>
                    <Td>{fmt(c.execution.startedAt)}</Td>
                    <Td>{elapsed(c.execution.startedAt, c.execution.completedAt)}</Td>
                    <Td>
                      {ownerLabel && (c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning') && (
                        <Label color={c.owner === 'customer' ? 'gold' : 'blue'} isCompact>
                          {ownerLabel}
                        </Label>
                      )}
                    </Td>
                  </Tr>
                  {isExpanded && (
                    <Tr isExpanded>
                      <Td colSpan={7}>
                        <CheckRowDetail c={c} />
                      </Td>
                    </Tr>
                  )}
                </React.Fragment>
              );
            })}
          </Tbody>
        </Table>
      )}
      {sorted.length === 0 && (
        <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>
          Checks have not started yet.
        </span>
      )}
    </div>
  );
};
