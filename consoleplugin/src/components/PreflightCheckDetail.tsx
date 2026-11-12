import * as React from 'react';
import { List, ListItem } from '@patternfly/react-core';
import { type UpgradePreflightCheck, type PreflightCheckResult, type CheckResult } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props { pfc: UpgradePreflightCheck; }

const DESCRIPTION_ANNOTATION = 'preflight.managed.openshift.io/description';

const SEVERITY: Record<CheckResult, number> = {
  Error: 0, Failed: 1, Warning: 2, Unknown: 3, Passed: 4, Skipped: 5, TimedOut: 6,
};

const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const fmt      = (ts?: string) => ts ? new Date(ts).toLocaleString() : '—';

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

// Inline-styled severity indicator for check rows — no PF CSS dependency
const checkBorderColor = (result: CheckResult): string => {
  if (result === 'Failed')  return '#c9190b';
  if (result === 'Error')   return '#c95f0b';
  if (result === 'Warning') return '#c58c00';
  if (result === 'Passed')  return '#5ba352';
  return 'transparent';
};

// Custom inline banner — avoids PF Alert whose variant text shows as literal
// "Danger alert:" in the console plugin iframe when PF CSS is not fully loaded.
const SummaryBanner: React.FC<{
  issueCount: number;
  customerItems: PreflightCheckResult[];
  redHatItems: PreflightCheckResult[];
  otherItems: PreflightCheckResult[];
  hasErrors: boolean;
}> = ({ issueCount, customerItems, redHatItems, otherItems, hasErrors }) => {
  const borderColor = hasErrors ? '#c9190b' : '#c58c00';
  const bg          = hasErrors ? 'rgba(201,25,11,0.1)' : 'rgba(197,140,0,0.1)';
  const icon        = hasErrors ? '✕' : '⚠';

  return (
    <div style={{
      padding: '12px 16px',
      marginBottom: 16,
      borderLeft: `4px solid ${borderColor}`,
      background: bg,
      borderRadius: 4,
    }}>
      <div style={{ fontWeight: 700, color: borderColor, marginBottom: 8 }}>
        {icon} {issueCount} issue{issueCount !== 1 ? 's' : ''} found — upgrade may be blocked
      </div>
      {customerItems.length > 0 && (
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>Customer action required:</strong>{' '}
          {customerItems.map(c => humanize(c.name)).join(', ')}
        </div>
      )}
      {redHatItems.length > 0 && (
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>Red Hat action:</strong>{' '}
          {redHatItems.map(c => humanize(c.name)).join(', ')}
        </div>
      )}
      {otherItems.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <strong>Needs attention:</strong>{' '}
          {otherItems.map(c => humanize(c.name)).join(', ')}
        </div>
      )}
    </div>
  );
};

// Expanded check row content
const CheckRowDetail: React.FC<{ c: PreflightCheckResult }> = ({ c }) => {
  const ownerLabel = c.owner === 'customer'
    ? 'Customer action required'
    : c.owner === 'service-team'
    ? 'Red Hat action required'
    : null;

  const hasContent = c.execution.summary || c.action || c.execution.error ||
    (c.execution.findings && c.execution.findings.length > 0) || ownerLabel;

  if (!hasContent) {
    return <div style={{ padding: '8px 0', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No additional details.</div>;
  }

  return (
    <div style={{ padding: '10px 0 10px 16px' }}>
      {/* Owner badge */}
      {ownerLabel && (c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning') && (
        <div style={{ marginBottom: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20, fontWeight: 600, fontSize: 12,
            ...(c.owner === 'customer'
              ? { background: 'rgba(197,140,0,0.15)', color: '#c58c00', border: '1px solid rgba(197,140,0,0.4)' }
              : { background: 'rgba(0,102,204,0.15)', color: '#4a9fd4', border: '1px solid rgba(0,102,204,0.4)' }),
          }}>
            {ownerLabel}
          </span>
        </div>
      )}

      {/* Summary text */}
      {c.execution.summary && (
        <div style={{ marginBottom: 8, fontSize: 14 }}>{c.execution.summary}</div>
      )}

      {/* Error */}
      {c.execution.error && (
        <div style={{
          marginBottom: 10, padding: '8px 12px',
          background: 'rgba(201,25,11,0.1)',
          borderLeft: '3px solid #c9190b',
          borderRadius: 4, fontSize: 13, fontFamily: 'monospace',
          wordBreak: 'break-word',
        }}>
          {c.execution.error}
        </div>
      )}

      {/* Findings */}
      {c.execution.findings && c.execution.findings.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Findings:</div>
          <List style={{ fontSize: 13 }}>
            {c.execution.findings.map((f, i) => <ListItem key={i}>{f}</ListItem>)}
          </List>
        </div>
      )}

      {/* Action required */}
      {c.action && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: c.owner === 'customer' ? 'rgba(197,140,0,0.1)' : 'rgba(0,102,204,0.1)',
          borderLeft: `3px solid ${c.owner === 'customer' ? '#c58c00' : '#4a9fd4'}`,
          borderRadius: 4, fontSize: 13,
        }}>
          <strong>Action required:</strong> {c.action}
        </div>
      )}

      {/* Elapsed time (moved from table column) */}
      {c.execution.startedAt && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          Duration: {elapsed(c.execution.startedAt, c.execution.completedAt)}
        </div>
      )}
    </div>
  );
};

export const PreflightCheckDetail: React.FC<Props> = ({ pfc }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (name: string) => setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const description = pfc.metadata?.annotations?.[DESCRIPTION_ANNOTATION];
  const s           = pfc.status;
  const sorted      = [...(s?.checks ?? [])].sort(
    (a, b) => (SEVERITY[a.result] ?? 3) - (SEVERITY[b.result] ?? 3)
  );

  const platformLabel = pfc.spec.type === 'OSD'
    ? 'OpenShift Dedicated'
    : pfc.spec.type === 'ARO'
    ? 'Azure Red Hat OpenShift'
    : pfc.spec.type;

  // Summary banner data
  const issueChecks    = sorted.filter(c => c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning');
  const customerItems  = issueChecks.filter(c => c.owner === 'customer');
  const redHatItems    = issueChecks.filter(c => c.owner === 'service-team');
  const otherItems     = issueChecks.filter(c => !c.owner || (c.owner !== 'customer' && c.owner !== 'service-team'));
  const issueCount     = issueChecks.length;
  const hasErrors      = sorted.some(c => c.result === 'Error' || c.result === 'Failed');

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', marginBottom: 2,
  };

  const metaItems: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Target version', value: <strong style={{ fontSize: 15 }}>{pfc.spec.desired.version}</strong> },
    { label: 'Channel',        value: pfc.spec.desired.channel },
    { label: 'Platform',       value: platformLabel },
    { label: 'Overall result', value: s?.overallResult ? <StatusBadge result={s.overallResult} /> : '—' },
    { label: 'Started',        value: fmt(s?.startedAt) },
    { label: 'Completed',      value: fmt(s?.completedAt) },
    { label: 'Duration',       value: elapsed(s?.startedAt, s?.completedAt) },
    ...(description ? [{ label: 'Description', value: description }] : []),
  ];

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left' as const,
    fontWeight: 700,
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.45)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    whiteSpace: 'nowrap' as const,
  };

  const tdBase: React.CSSProperties = {
    padding: '10px 12px',
    verticalAlign: 'top',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    fontSize: 13,
  };

  return (
    <div style={{ padding: '16px 20px' }}>

      {/* Summary banner */}
      {issueCount > 0 && (
        <SummaryBanner
          issueCount={issueCount}
          customerItems={customerItems}
          redHatItems={redHatItems}
          otherItems={otherItems}
          hasErrors={hasErrors}
        />
      )}

      {/* Metadata two-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '14px 32px',
        marginBottom: 20,
        padding: '14px 16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
      }}>
        {metaItems.map(({ label, value }) => (
          <div key={label}>
            <div style={labelStyle}>{label}</div>
            <div style={{ fontSize: 14 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Individual checks table */}
      {sorted.length > 0 ? (
        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th style={{ ...thStyle, width: 28, padding: '8px 6px' }} />
                <th style={thStyle}>Check</th>
                <th style={{ ...thStyle, width: 110 }}>Result</th>
                <th style={{ ...thStyle, width: 100 }}>Status</th>
                <th style={{ ...thStyle, width: 170 }}>Started</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, idx) => {
                const isExpanded   = !!expanded[c.name];
                const borderColor  = checkBorderColor(c.result);
                const stateLabel   = { Completed: 'Completed', Error: 'Error', Skipped: 'Skipped', TimedOut: 'Timed Out' }[c.execution.state] ?? c.execution.state;
                const hasDetail    = c.execution.error || c.action || c.execution.summary || (c.execution.findings?.length ?? 0) > 0;

                return (
                  <React.Fragment key={c.name}>
                    <tr
                      style={{ borderLeft: `3px solid ${borderColor}`, cursor: hasDetail ? 'pointer' : 'default' }}
                      onClick={() => hasDetail && toggle(c.name)}
                    >
                      <td style={{ ...tdBase, padding: '10px 6px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                        {hasDetail ? (isExpanded ? '▾' : '▸') : ''}
                      </td>
                      <td style={tdBase}>
                        <div style={{ fontWeight: 600 }}>{humanize(c.name)}</div>
                        {c.description && (
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                            {truncate(c.description)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
                        <StatusBadge result={c.result} />
                      </td>
                      <td style={{ ...tdBase, color: 'rgba(255,255,255,0.5)' }}>{stateLabel}</td>
                      <td style={{ ...tdBase, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                        {fmt(c.execution.startedAt)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderLeft: `3px solid ${borderColor}`, background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <CheckRowDetail c={c} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Checks have not started yet.</div>
      )}
    </div>
  );
};
