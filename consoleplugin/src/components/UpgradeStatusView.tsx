import * as React from 'react';
import { Alert, Button, Spinner } from '@patternfly/react-core';
import { SyncAltIcon, CaretDownIcon, CaretRightIcon } from '@patternfly/react-icons';
import { consoleFetch } from '@openshift-console/dynamic-plugin-sdk';

const STATUS_API = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/upgrade-status';
const POLL_INTERVAL_MS = 30_000;

// ---- Types (mirror upgrade_status.go response) ----------------------------

interface NodeStatus {
  name: string;
  phase: string;
  currentConfig?: string;
  desiredConfig?: string;
  phaseSince?: string;
  elapsedSeconds?: number;
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
  'complete':       '#5ba352',
  'updated':        '#5ba352',
  'done':           '#5ba352',
  'available':      '#5ba352',
  'not-started':    'rgba(255,255,255,0.35)',
  'upgrading':      '#73bcf7',
  'updating':       '#73bcf7',
  'control-plane':  '#73bcf7',
  'operators':      '#73bcf7',
  'worker-upgrade': '#73bcf7',
  'progressing':    '#73bcf7',
  'working':        '#73bcf7',
  'rebooting':      '#c58c00',
  'draining':       '#c58c00',
  'pre-checks':     '#c58c00',
  'stalled':        '#c95f0b',
  'degraded':       '#c9190b',
  'failed':         '#c9190b',
};

const phaseColor  = (p: string) => PHASE_COLORS[p] ?? 'rgba(255,255,255,0.35)';
const phaseLabel  = (p: string) => p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const PhaseBadge: React.FC<{ phase: string; size?: 'sm' | 'md' }> = ({ phase, size = 'sm' }) => {
  const color = phaseColor(phase);
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'md' ? '3px 12px' : '1px 8px',
      borderRadius: 20,
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
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'rgba(255,255,255,0.5)',
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
    color: 'rgba(255,255,255,0.4)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
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
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            verticalAlign: 'top',
          };
          return (
            <tr key={op.name} style={{ borderLeft: op.degraded || op.progressing ? `3px solid ${color}` : '3px solid transparent' }}>
              <td style={{ ...tdStyle, fontWeight: op.degraded || op.progressing ? 600 : 400 }}>{op.name}</td>
              <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 12 }}>
                {op.version ?? '—'}
              </td>
              <td style={tdStyle}><PhaseBadge phase={op.phase} /></td>
              <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
                {fmtElapsed(op.elapsedInPhaseSeconds)}
              </td>
              <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.55)', fontSize: 12, wordBreak: 'break-word' }}>
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
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    border: `1px solid ${highlight ? color + '55' : 'rgba(255,255,255,0.08)'}`,
  });

  const th: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.4)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
  };

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
      {/* Pool header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.04)',
        borderBottom: expanded ? '1px solid rgba(255,255,255,0.1)' : undefined,
        borderLeft: `4px solid ${color}`,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{pool.name}</span>
        <PhaseBadge phase={pool.phase} size="sm" />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {/* Count pills */}
          <span style={countStyle(pool.updated < pool.total)}>
            <span style={{ fontSize: 16, fontWeight: 700, color: pool.updated === pool.total ? '#5ba352' : '#73bcf7' }}>
              {pool.updated}/{pool.total}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>updated</span>
          </span>
          <span style={countStyle()}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{pool.ready}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>ready</span>
          </span>
          {pool.unavailable > 0 && (
            <span style={countStyle(true)}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#c58c00' }}>{pool.unavailable}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>unavailable</span>
            </span>
          )}
          {pool.degraded > 0 && (
            <span style={countStyle(true)}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#c9190b' }}>{pool.degraded}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>degraded</span>
            </span>
          )}
          {pool.elapsedSeconds !== undefined && pool.elapsedSeconds > 0 && (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', alignSelf: 'center', marginLeft: 4 }}>
              {fmtElapsed(pool.elapsedSeconds)}
            </span>
          )}
        </span>
        {pool.nodes && pool.nodes.length > 0 && (
          <Button
            variant="plain"
            aria-label={expanded ? 'Collapse nodes' : 'Expand nodes'}
            onClick={() => setExpanded(e => !e)}
            style={{ color: 'rgba(255,255,255,0.4)', padding: '0 4px' }}
          >
            {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
          </Button>
        )}
      </div>

      {/* Node table */}
      {expanded && pool.nodes && pool.nodes.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>Node</th>
              <th style={th}>Phase</th>
              <th style={th}>Config</th>
              <th style={th}>Phase Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {pool.nodes.map(node => {
              const nc = phaseColor(node.phase);
              const configMatch = node.currentConfig === node.desiredConfig;
              return (
                <tr key={node.name}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontFamily: 'monospace' }}>
                    {node.name}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <PhaseBadge phase={node.phase} />
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {configMatch
                      ? <span style={{ color: '#5ba352' }}>✓ current</span>
                      : <span style={{ color: nc, fontSize: 11, fontFamily: 'monospace' }}>
                          {(node.desiredConfig ?? '').slice(-8)}
                        </span>
                    }
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
                    {fmtElapsed(node.elapsedSeconds)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
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
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
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
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Current Version
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>
                  {snapshot.currentVersion ?? '—'}
                </div>
              </div>
              {snapshot.targetVersion && snapshot.targetVersion !== snapshot.currentVersion && (
                <>
                  <div style={{ alignSelf: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 20 }}>→</div>
                  <div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      Target Version
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#73bcf7' }}>
                      {snapshot.targetVersion}
                    </div>
                  </div>
                </>
              )}
              {snapshot.elapsedSeconds !== undefined && snapshot.elapsedSeconds > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
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
                  const color = done ? '#5ba352' : active ? '#73bcf7' : 'rgba(255,255,255,0.2)';
                  return (
                    <React.Fragment key={ph}>
                      {ph !== 'control-plane' && (
                        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>→</span>
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
                borderTop: '1px solid rgba(255,255,255,0.08)',
                fontSize: 12, color: 'rgba(255,255,255,0.5)',
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

          {/* ---- Cluster Operators ---- */}
          <div style={cardStyle}>
            <SectionHeader
              title="Cluster Operators"
              badge={<PhaseBadge phase={snapshot.clusterOperators.phase} />}
              meta={`${snapshot.clusterOperators.available}/${snapshot.clusterOperators.total} available` +
                (snapshot.clusterOperators.progressing > 0 ? ` · ${snapshot.clusterOperators.progressing} progressing` : '') +
                (snapshot.clusterOperators.degraded > 0 ? ` · ${snapshot.clusterOperators.degraded} degraded` : '') +
                (snapshot.clusterOperators.elapsedSeconds ? ` · ${fmtElapsed(snapshot.clusterOperators.elapsedSeconds)} elapsed` : '')
              }
            />
            {snapshot.clusterOperators.operators && (
              <OperatorsTable ops={snapshot.clusterOperators} />
            )}
          </div>

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
