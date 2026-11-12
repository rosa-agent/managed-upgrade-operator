import * as React from 'react';
import {
  Alert, Label, List, ListItem,
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

const truncate = (s: string, max = 100): string =>
  s.length > max ? s.slice(0, max) + '…' : s;

// Left border color for check rows
const checkBorderColor = (result: CheckResult): string => {
  if (result === 'Failed')  return 'var(--pf-v5-global--palette--red-200)';
  if (result === 'Error')   return 'var(--pf-v5-global--palette--orange-300)';
  if (result === 'Warning') return 'var(--pf-v5-global--palette--gold-300)';
  if (result === 'Passed')  return 'var(--pf-v5-global--palette--green-300)';
  return 'transparent';
};

const STATE_LABEL: Record<string, string> = {
  Completed: 'Completed',
  Error:     'Error',
  Skipped:   'Skipped',
  TimedOut:  'Timed Out',
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
    <div style={{ padding: '8px 0 8px 16px' }}>
      {c.execution.summary && (
        <p style={{ margin: '0 0 8px' }}>{c.execution.summary}</p>
      )}
      {c.execution.error && (
        <Alert variant="danger" isInline isPlain title={c.execution.error} style={{ marginBottom: 8 }} />
      )}
      {c.execution.findings && c.execution.findings.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <strong>Findings:</strong>
          <List style={{ marginTop: 4 }}>
            {c.execution.findings.map((f, i) => <ListItem key={i}>{f}</ListItem>)}
          </List>
        </div>
      )}
      {c.action && (
        <Alert
          variant={c.owner === 'customer' ? 'warning' : 'info'}
          isInline
          isPlain
          title={`Action required: ${c.action}`}
        />
      )}
    </div>
  );
};

// Two-column metadata grid using CSS grid (more reliable than PF DescriptionList in plugin context)
const MetaGrid: React.FC<{ items: Array<{ label: string; value: React.ReactNode }> }> = ({ items }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 32px',
    marginBottom: 24,
    padding: '16px',
    background: 'var(--pf-v5-global--BackgroundColor--200)',
    borderRadius: 'var(--pf-v5-global--BorderRadius--sm)',
  }}>
    {items.map(({ label, value }) => (
      <div key={label}>
        <div style={{
          fontSize: 'var(--pf-v5-global--FontSize--sm)',
          color: 'var(--pf-v5-global--Color--200)',
          fontWeight: 600,
          marginBottom: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          {label}
        </div>
        <div>{value}</div>
      </div>
    ))}
  </div>
);

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

  // Build summary banner content
  const issueChecks = sorted.filter(c => c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning');
  const customerItems = issueChecks.filter(c => c.owner === 'customer');
  const redHatItems   = issueChecks.filter(c => c.owner === 'service-team');
  const otherItems    = issueChecks.filter(c => !c.owner || (c.owner !== 'customer' && c.owner !== 'service-team'));

  const failed  = sorted.filter(c => c.result === 'Failed').length;
  const errored = sorted.filter(c => c.result === 'Error').length;
  const warned  = sorted.filter(c => c.result === 'Warning').length;
  const issueCount = failed + errored + warned;

  const metaItems = [
    { label: 'Target version', value: <strong>{pfc.spec.desired.version}</strong> },
    { label: 'Channel',        value: pfc.spec.desired.channel },
    { label: 'Platform',       value: platformLabel },
    { label: 'Overall result', value: s?.overallResult ? <StatusBadge result={s.overallResult} /> : '—' },
    { label: 'Started',        value: fmt(s?.startedAt) },
    { label: 'Completed',      value: fmt(s?.completedAt) },
    { label: 'Duration',       value: elapsed(s?.startedAt, s?.completedAt) },
    ...(description ? [{ label: 'Description', value: description }] : []),
  ];

  return (
    <div style={{ padding: '16px 0 8px' }}>

      {/* Summary banner — only shown when there are issues */}
      {issueCount > 0 && (
        <Alert
          variant={errored > 0 ? 'danger' : failed > 0 ? 'warning' : 'info'}
          isInline
          title={`${issueCount} issue${issueCount !== 1 ? 's' : ''} found — upgrade may be blocked`}
          style={{ marginBottom: 16 }}
        >
          {customerItems.length > 0 && (
            <p style={{ margin: '4px 0 0' }}>
              <strong>Customer action required:</strong>{' '}
              {customerItems.map(c => humanize(c.name)).join(', ')}
            </p>
          )}
          {redHatItems.length > 0 && (
            <p style={{ margin: '4px 0 0' }}>
              <strong>Red Hat action:</strong>{' '}
              {redHatItems.map(c => humanize(c.name)).join(', ')}
            </p>
          )}
          {otherItems.length > 0 && (
            <p style={{ margin: '4px 0 0' }}>
              <strong>Needs attention:</strong>{' '}
              {otherItems.map(c => humanize(c.name)).join(', ')}
            </p>
          )}
        </Alert>
      )}

      {/* Metadata grid */}
      <MetaGrid items={metaItems} />

      {/* Checks table */}
      {sorted.length > 0 ? (
        <Table aria-label="Individual checks" variant="compact">
          <Thead>
            <Tr>
              <Th style={{ width: 32 }} />
              <Th style={{ minWidth: 200 }}>Check</Th>
              <Th style={{ width: 110 }}>Result</Th>
              <Th style={{ width: 100 }}>Status</Th>
              <Th style={{ width: 160 }}>Started</Th>
              <Th style={{ width: 80 }}>Elapsed</Th>
              <Th style={{ minWidth: 180 }}>Owner</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((c, rowIndex) => {
              const isExpanded = !!expanded[c.name];
              const ownerLabel = c.owner ? OWNER_LABEL[c.owner] : null;
              const stateLabel = STATE_LABEL[c.execution.state] ?? c.execution.state;
              const borderColor = checkBorderColor(c.result);
              const isIssue = c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning';

              return (
                <React.Fragment key={c.name}>
                  <Tr style={{ borderLeft: `4px solid ${borderColor}` }}>
                    <Td
                      expand={{ isExpanded, onToggle: () => toggle(c.name), rowIndex }}
                    />
                    <Td>
                      <div style={{ fontWeight: 600 }}>{humanize(c.name)}</div>
                      {c.description && (
                        <div style={{
                          fontSize: 'var(--pf-v5-global--FontSize--sm)',
                          color: 'var(--pf-v5-global--Color--200)',
                          marginTop: 2,
                        }}>
                          {truncate(c.description)}
                        </div>
                      )}
                    </Td>
                    <Td><StatusBadge result={c.result} /></Td>
                    <Td style={{ color: 'var(--pf-v5-global--Color--200)' }}>{stateLabel}</Td>
                    <Td style={{ color: 'var(--pf-v5-global--Color--200)', fontSize: 'var(--pf-v5-global--FontSize--sm)' }}>
                      {fmt(c.execution.startedAt)}
                    </Td>
                    <Td style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                      {elapsed(c.execution.startedAt, c.execution.completedAt)}
                    </Td>
                    <Td>
                      {ownerLabel && isIssue && (
                        <Label
                          color={c.owner === 'customer' ? 'gold' : 'blue'}
                          isCompact
                        >
                          {ownerLabel}
                        </Label>
                      )}
                    </Td>
                  </Tr>
                  {isExpanded && (
                    <Tr isExpanded style={{ borderLeft: `4px solid ${borderColor}` }}>
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
      ) : (
        <span style={{ color: 'var(--pf-v5-global--Color--200)' }}>
          Checks have not started yet.
        </span>
      )}
    </div>
  );
};
