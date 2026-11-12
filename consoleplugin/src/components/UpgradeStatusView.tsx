import * as React from 'react';
import { Alert, Button, Spinner } from '@patternfly/react-core';
import { SyncAltIcon, CaretDownIcon, CaretRightIcon } from '@patternfly/react-icons';
import { consoleFetch } from '@openshift-console/dynamic-plugin-sdk';

const STATUS_API = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/upgrade-status';
const POLL_INTERVAL_MS = 30_000;

// PF semantic design tokens — single source of truth for all colors in this file.
const T = {
  danger:     'var(--pf-t--global--color--status--danger--default)',
  warning:    'var(--pf-t--global--color--status--warning--default)',
  success:    'var(--pf-t--global--color--status--success--default)',
  info:       'var(--pf-t--global--color--status--info--default)',
  textSubtle: 'var(--pf-t--global--color--text--subtle)',
  textMuted:  'var(--pf-t--global--color--text--placeholder)',
  border:     'var(--pf-t--global--border--color--default)',
  bgSecondary:'var(--pf-t--global--background--color--secondary--default)',
  shadow:     'var(--pf-t--global--shadow--md)',
  dangerBg:   'var(--pf-t--global--background--color--status--danger--default)',
  warningBg:  'var(--pf-t--global--background--color--status--warning--default)',
  infoBg:     'var(--pf-t--global--background--color--status--info--default)',
  radiusPill: 'var(--pf-t--global--border--radius--pill)',
  radiusLg:   'var(--pf-t--global--border--radius--lg)',
  radiusMd:   'var(--pf-t--global--border--radius--md)',
  radiusSm:   'var(--pf-t--global--border--radius--sm)',
} as const;

// ---- Types (mirror upgrade_status.go response) ----------------------------

interface DrainBlocker {
  podName: string;
  podNamespace: string;
  pdbName: string;
  owner?: string;
  disruptionsAllowed: number;
  desiredHealthy: number;
  currentHealthy: number;
  violation?: string;
}

interface ProviderError {
  source: string;
  reason?: string;
  message: string;
  since?: string;
}

interface NodeStatus {
  name: string;
  phase: string;
  currentConfig?: string;
  desiredConfig?: string;
  phaseSince?: string;
  elapsedSeconds?: number;
  drainBlockers?: DrainBlocker[];
  providerErrors?: ProviderError[];
}

interface MachinePoolStatus {
  name: string;
  phase: string;
  total: number;
  updated: number;
  ready: number;
  unavailable: number;
  degraded: number;
  startedAt?: string;
  completedAt?: string;
  elapsedSeconds?: number;
  nodes?: NodeStatus[];
}

interface OperatorStatus {
  name: string;
  phase: string;
  version?: string;
  available: boolean;
  progressing: boolean;
  degraded: boolean;
  message?: string;
  progressingSince?: string;
  elapsedInPhaseSeconds?: number;
}

interface OperatorsStatus {
  phase: string;
  total: number;
  available: number;
  progressing: number;
  degraded: number;
  startedAt?: string;
  elapsedSeconds?: number;
  operators: OperatorStatus[];
}

interface ControlPlaneStatus {
  phase: string;
  startedAt?: string;
  completedAt?: string;
  elapsedSeconds?: number;
  message?: string;
}

interface UpgradeBlocker {
  type: string;
  component: string;
  message: string;
  since?: string;
  elapsedSeconds?: number;
}

interface UpgradeSnapshot {
  phase: string;
  targetVersion?: string;
  currentVersion?: string;
  cvoMessage?: string;
  startedAt?: string;
  elapsedSeconds?: number;
  controlPlane: ControlPlaneStatus;
  clusterOperators: OperatorsStatus;
  machinePools: MachinePoolStatus[];
  blockers?: UpgradeBlocker[];
}

// ---- Colour helpers --------------------------------------------------------

const PHASE_COLORS: Record<string, string> = {
  'complete':       T.success,
  'updated':        T.success,
  'done':           T.success,
  'available':      T.success,
  'not-started':    'var(--pf-t--global--color--text--subtle)',
  'upgrading':      T.info,
  'updating':       T.info,
  'control-plane':  T.info,
  'operators':      T.info,
  'worker-upgrade': T.info,
  'progressing':    T.info,
  'working':        T.info,
  'rebooting':      T.warning,
  'draining':       T.warning,
  'pre-checks':     T.warning,
  'stalled':        T.warning,
  'degraded':       T.danger,
  'failed':         T.danger,
};

const phaseColor  = (p: string) => PHASE_COLORS[p] ?? 'var(--pf-t--global--color--text--subtle)';
const phaseLabel  = (p: string) => p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const PhaseBadge: React.FC<{ phase: string; size?: 'sm' | 'md' }> = ({ phase, size = 'sm' }) => {
  const color = phaseColor(phase);
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'md' ? '3px 12px' : '1px 8px',
      borderRadius: T.radiusPill,
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      fontWeight: 600,
      fontSize: size === 'md' ? 13 : 11,
      whiteSpace: 'nowrap',
    }}>
      {phaseLabel(phase)}
    </span>
  );
};

// ---- Elapsed time formatting -----------------------------------------------

const fmtElapsed = (secs?: number): string => {
  if (!secs || secs <= 0) return '—';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
};

// ---- Section header --------------------------------------------------------

const SectionHeader: React.FC<{ title: string; badge?: React.ReactNode; meta?: string }> = ({ title, badge, meta }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 16px',
    background: 'var(--pf-t--global--color--text--subtle)',
    borderBottom: `1px solid ${T.border}`,
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'var(--pf-t--global--color--text--subtle)',
  }}>
    <span>{title}</span>
    {badge}
    {meta && <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{meta}</span>}
  </div>
);

// ---- Operators table -------------------------------------------------------

const OperatorsTable: React.FC<{ ops: OperatorsStatus }> = ({ ops }) => {
  const sorted = [...ops.operators].sort((a, b) => {
    const rank = (o: OperatorStatus) => o.degraded ? 0 : o.progressing ? 1 : 2;
    return rank(a) - rank(b);
  });

  const th: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--pf-t--global--color--text--subtle)',
    borderBottom: `1px solid ${T.border}`,
    background: 'var(--pf-t--global--color--text--subtle)',
    whiteSpace: 'nowrap',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={th}>Operator</th>
          <th style={th}>Version</th>
          <th style={th}>Phase</th>
          <th style={th}>Elapsed</th>
          <th style={{ ...th, width: '40%' }}>Message</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((op) => {
          const color = phaseColor(op.phase);
          const tdStyle: React.CSSProperties = {
            padding: '8px 12px',
            borderBottom: `1px solid ${T.border}`,
            verticalAlign: 'top',
          };
          return (
            <tr key={op.name} style={{ borderLeft: op.degraded || op.progressing ? `3px solid ${color}` : '3px solid transparent' }}>
              <td style={{ ...tdStyle, fontWeight: op.degraded || op.progressing ? 600 : 400 }}>{op.name}</td>
              <td style={{ ...tdStyle, color: 'var(--pf-t--global--color--text--subtle)', fontFamily: 'monospace', fontSize: 12 }}>
                {op.version ?? '—'}
              </td>
              <td style={tdStyle}><PhaseBadge phase={op.phase} /></td>
              <td style={{ ...tdStyle, color: 'var(--pf-t--global--color--text--subtle)', whiteSpace: 'nowrap' }}>
                {fmtElapsed(op.elapsedInPhaseSeconds)}
              </td>
              <td style={{ ...tdStyle, color: 'var(--pf-t--global--color--text--subtle)', fontSize: 12, wordBreak: 'break-word' }}>
                {op.message ?? '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// ---- Machine pool section --------------------------------------------------

const MachinePoolCard: React.FC<{ pool: MachinePoolStatus }> = ({ pool }) => {
  const [expanded, setExpanded] = React.useState(false);
  const color = phaseColor(pool.phase);

  const countStyle = (highlight?: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '6px 14px',
    background: 'var(--pf-t--global--color--text--subtle)',
    borderRadius: T.radiusMd,
    border: `1px solid ${highlight ? color + '55' : 'var(--pf-t--global--color--text--subtle)'}`,
  });

  const th: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--pf-t--global--color--text--subtle)',
    borderBottom: `1px solid ${T.border}`,
    background: 'var(--pf-t--global--color--text--subtle)',
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusMd, overflow: 'hidden', marginBottom: 12 }}>
      {/* Pool header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'var(--pf-t--global--color--text--subtle)',
        borderBottom: expanded ? `1px solid ${T.border}` : undefined,
        borderLeft: `4px solid ${color}`,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{pool.name}</span>
        <PhaseBadge phase={pool.phase} size="sm" />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {/* Count pills */}
          <span style={countStyle(pool.updated < pool.total)}>
            <span style={{ fontSize: 16, fontWeight: 700, color: pool.updated === pool.total ? T.success : T.info }}>
              {pool.updated}/{pool.total}
            </span>
            <span style={{ fontSize: 10, color: 'var(--pf-t--global--color--text--subtle)' }}>updated</span>
          </span>
          <span style={countStyle()}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{pool.ready}</span>
            <span style={{ fontSize: 10, color: 'var(--pf-t--global--color--text--subtle)' }}>ready</span>
          </span>
          {pool.unavailable > 0 && (
            <span style={countStyle(true)}>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.warning }}>{pool.unavailable}</span>
              <span style={{ fontSize: 10, color: 'var(--pf-t--global--color--text--subtle)' }}>unavailable</span>
            </span>
          )}
          {pool.degraded > 0 && (
            <span style={countStyle(true)}>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.danger }}>{pool.degraded}</span>
              <span style={{ fontSize: 10, color: 'var(--pf-t--global--color--text--subtle)' }}>degraded</span>
            </span>
          )}
          {pool.elapsedSeconds !== undefined && pool.elapsedSeconds > 0 && (
            <span style={{ fontSize: 12, color: 'var(--pf-t--global--color--text--subtle)', alignSelf: 'center', marginLeft: 4 }}>
              {fmtElapsed(pool.elapsedSeconds)}
            </span>
          )}
        </span>
        {pool.nodes && pool.nodes.length > 0 && (
          <Button
            variant="plain"
            aria-label={expanded ? 'Collapse nodes' : 'Expand nodes'}
            onClick={() => setExpanded(e => !e)}
            style={{ color: 'var(--pf-t--global--color--text--subtle)', padding: '0 4px' }}
          >
            {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
          </Button>
        )}
      </div>

      {/* Node table */}
      {expanded && pool.nodes && pool.nodes.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: '28%' }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th style={th}>Node</th>
              <th style={th}>Phase</th>
              <th style={th}>Config</th>
              <th style={th}>Elapsed</th>
              <th style={th}>Issues</th>
            </tr>
          </thead>
          <tbody>
            {pool.nodes.map(node => {
              const nc = phaseColor(node.phase);
              const configMatch = node.currentConfig === node.desiredConfig;
              const hasBlockers = (node.drainBlockers?.length ?? 0) > 0;
              const hasProviderErrors = (node.providerErrors?.length ?? 0) > 0;
              const hasIssues = hasBlockers || hasProviderErrors;
              const tdBase: React.CSSProperties = {
                padding: '7px 10px',
                borderBottom: `1px solid ${T.border}`,
                verticalAlign: 'top',
              };
              return (
                <React.Fragment key={node.name}>
                  <tr style={{ borderLeft: hasIssues ? `3px solid ${nc}` : '3px solid transparent' }}>
                    <td style={{ ...tdBase, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                      {node.name}
                    </td>
                    <td style={tdBase}><PhaseBadge phase={node.phase} /></td>
                    <td style={tdBase}>
                      {configMatch
                        ? <span style={{ color: T.success }}>✓ current</span>
                        : <span style={{ color: nc, fontFamily: 'monospace', fontSize: 11 }}>
                            →{(node.desiredConfig ?? '').slice(-8)}
                          </span>
                      }
                    </td>
                    <td style={{ ...tdBase, color: 'var(--pf-t--global--color--text--subtle)', whiteSpace: 'nowrap' }}>
                      {fmtElapsed(node.elapsedSeconds)}
                    </td>
                    <td style={tdBase}>
                      {hasBlockers && (
                        <span style={{ color: T.danger, fontWeight: 600 }}>
                          {node.drainBlockers!.length} PDB blocker{node.drainBlockers!.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {hasProviderErrors && (
                        <span style={{ color: T.warning, fontWeight: 600, marginLeft: hasBlockers ? 8 : 0 }}>
                          {node.providerErrors!.length} provider error{node.providerErrors!.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {!hasIssues && <span style={{ color: 'var(--pf-t--global--color--text--subtle)' }}>—</span>}
                    </td>
                  </tr>

                  {/* PDB drain blockers — one sub-row per blocker */}
                  {hasBlockers && node.drainBlockers!.map((db, i) => (
                    <tr key={`db-${i}`} style={{ background: T.dangerBg }}>
                      <td colSpan={5} style={{ padding: '5px 10px 5px 24px', borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>
                        <span style={{ color: T.danger, fontWeight: 700 }}>PDB block: </span>
                        <span style={{ color: 'var(--pf-t--global--color--text--subtle)', fontFamily: 'monospace' }}>
                          {db.podNamespace}/{db.pdbName}
                        </span>
                        {db.owner && (
                          <span style={{ color: 'var(--pf-t--global--color--text--subtle)', marginLeft: 8 }}>owner: {db.owner}</span>
                        )}
                        <span style={{ color: 'var(--pf-t--global--color--text--subtle)', marginLeft: 8 }}>
                          disruptions allowed: {db.disruptionsAllowed} · healthy: {db.currentHealthy}/{db.desiredHealthy}
                        </span>
                        {db.violation && (
                          <span style={{ marginLeft: 8, color: T.danger, fontFamily: 'monospace' }}>[{db.violation}]</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* Provider / cloud errors — one sub-row per error */}
                  {hasProviderErrors && node.providerErrors!.map((pe, i) => (
                    <tr key={`pe-${i}`} style={{ background: T.warningBg }}>
                      <td colSpan={5} style={{ padding: '5px 10px 5px 24px', borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>
                        <span style={{ color: T.warning, fontWeight: 700 }}>
                          {pe.source}{pe.reason ? ` / ${pe.reason}` : ''}: </span>
                        <span style={{ color: 'var(--pf-t--global--color--text--subtle)' }}>{pe.message}</span>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ---- Collapsible operators card --------------------------------------------

const OperatorsCard: React.FC<{ ops: OperatorsStatus }> = ({ ops }) => {
  const [expanded, setExpanded] = React.useState(false);
  const color = phaseColor(ops.phase);

  const countPill = (n: number, label: string, c: string) => n > 0 ? (
    <span key={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 8px', borderRadius: T.radiusPill,
      background: `${c}22`, color: c, border: `1px solid ${c}55`,
      fontWeight: 600, fontSize: 11,
    }}>
      {n} {label}
    </span>
  ) : null;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusLg, overflow: 'hidden', marginBottom: 20, boxShadow: T.shadow }}>
      {/* Clickable header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '10px 16px',
          background: expanded ? 'var(--pf-t--global--color--text--subtle)' : 'var(--pf-t--global--color--text--subtle)',
          borderBottom: expanded ? `1px solid ${T.border}` : undefined,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--pf-t--global--color--text--subtle)' }}>
          Cluster Operators
        </span>
        <PhaseBadge phase={ops.phase} />
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {countPill(ops.available,    'available',   T.success)}
          {countPill(ops.progressing,  'progressing', T.info)}
          {countPill(ops.degraded,     'degraded',    T.danger)}
        </span>
        {ops.elapsedSeconds ? (
          <span style={{ fontSize: 12, color: 'var(--pf-t--global--color--text--subtle)', marginLeft: 4 }}>
            {fmtElapsed(ops.elapsedSeconds)} elapsed
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', color: 'var(--pf-t--global--color--text--subtle)', fontSize: 12 }}>
          {ops.total} total · {expanded ? 'collapse ▲' : 'expand ▼'}
        </span>
      </div>

      {expanded && ops.operators && <OperatorsTable ops={ops} />}
    </div>
  );
};

// ---- Main component --------------------------------------------------------

export const UpgradeStatusView: React.FC = () => {
  const [snapshot, setSnapshot]     = React.useState<UpgradeSnapshot | null>(null);
  const [loading, setLoading]       = React.useState(true);
  const [error, setError]           = React.useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchStatus = React.useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const resp = await consoleFetch(STATUS_API);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data: UpgradeSnapshot = await resp.json();
      setSnapshot(data);
      setError(null);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch upgrade status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const cardStyle: React.CSSProperties = {
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusLg,
    overflow: 'hidden',
    boxShadow: T.shadow,
    marginBottom: 20,
  };

  if (loading && !snapshot) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner aria-label="Loading upgrade status" />
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <Button
          variant="secondary"
          icon={<SyncAltIcon />}
          onClick={() => fetchStatus(true)}
          isDisabled={refreshing}
          isLoading={refreshing}
        >
          Refresh
        </Button>
        {lastRefresh && (
          <span style={{ fontSize: 12, color: 'var(--pf-t--global--color--text--subtle)' }}>
            Last updated {lastRefresh.toLocaleTimeString()} · auto-refreshes every 30s
          </span>
        )}
      </div>

      {error && (
        <Alert variant="danger" isInline title="Failed to load upgrade status" style={{ marginBottom: 16 }}>
          {error}
        </Alert>
      )}

      {snapshot && (
        <>
          {/* ---- Summary card ---- */}
          <div style={cardStyle}>
            <SectionHeader
              title="Cluster Upgrade"
              badge={<PhaseBadge phase={snapshot.phase} size="md" />}
            />
            <div style={{ padding: '14px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Version */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--pf-t--global--color--text--subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Current Version
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>
                  {snapshot.currentVersion ?? '—'}
                </div>
              </div>
              {snapshot.targetVersion && snapshot.targetVersion !== snapshot.currentVersion && (
                <>
                  <div style={{ alignSelf: 'center', color: 'var(--pf-t--global--color--text--subtle)', fontSize: 20 }}>→</div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--pf-t--global--color--text--subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      Target Version
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: T.info }}>
                      {snapshot.targetVersion}
                    </div>
                  </div>
                </>
              )}
              {snapshot.elapsedSeconds !== undefined && snapshot.elapsedSeconds > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--pf-t--global--color--text--subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Elapsed
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    {fmtElapsed(snapshot.elapsedSeconds)}
                  </div>
                </div>
              )}
              {/* Phase strip */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {(['control-plane', 'operators', 'worker-upgrade'] as const).map((ph) => {
                  const done = snapshot.phase === 'complete'
                    || (ph === 'control-plane' && ['operators', 'worker-upgrade', 'complete'].includes(snapshot.phase))
                    || (ph === 'operators' && ['worker-upgrade', 'complete'].includes(snapshot.phase));
                  const active = snapshot.phase === ph;
                  const color = done ? T.success : active ? T.info : 'var(--pf-t--global--color--text--subtle)';
                  return (
                    <React.Fragment key={ph}>
                      {ph !== 'control-plane' && (
                        <span style={{ color: 'var(--pf-t--global--color--text--subtle)', fontSize: 12 }}>→</span>
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color,
                        borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
                        paddingBottom: 1,
                      }}>
                        {phaseLabel(ph)}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            {snapshot.cvoMessage && (
              <div style={{
                padding: '8px 16px',
                borderTop: `1px solid ${T.border}`,
                fontSize: 12, color: 'var(--pf-t--global--color--text--subtle)',
                fontStyle: 'italic',
              }}>
                {snapshot.cvoMessage}
              </div>
            )}
          </div>

          {/* ---- Blockers ---- */}
          {snapshot.blockers && snapshot.blockers.length > 0 && (
            <Alert variant="danger" isInline title={`${snapshot.blockers.length} upgrade blocker(s) detected`} style={{ marginBottom: 20 }}>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {snapshot.blockers.map((b, i) => (
                  <li key={i}>
                    <strong>{b.component}</strong>
                    {b.elapsedSeconds ? ` (${fmtElapsed(b.elapsedSeconds)})` : ''}
                    {': '}{b.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {/* ---- Cluster Operators (collapsed by default) ---- */}
          <OperatorsCard ops={snapshot.clusterOperators} />

          {/* ---- Machine Pools ---- */}
          {snapshot.machinePools && snapshot.machinePools.length > 0 && (
            <div style={cardStyle}>
              <SectionHeader title="Machine Config Pools" />
              <div style={{ padding: '14px 16px' }}>
                {snapshot.machinePools.map(pool => (
                  <MachinePoolCard key={pool.name} pool={pool} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UpgradeStatusView;
