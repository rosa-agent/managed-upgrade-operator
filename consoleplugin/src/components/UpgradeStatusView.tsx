import * as React from 'react';
import { Alert, Button, Spinner } from '@patternfly/react-core';
import { SyncAltIcon, CaretDownIcon, CaretRightIcon } from '@patternfly/react-icons';
import { consoleFetch, useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { type UpgradeDiagsCheck } from '../types';

const STATUS_API = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/upgrade-status';
const POLL_INTERVAL_MS = 30_000;
const MUO_NS = 'openshift-managed-upgrade-operator';

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

interface NodeCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
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
  conditions?: NodeCondition[];
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

interface OperatorCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  since?: string;
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
  conditions?: OperatorCondition[];
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

interface MachineHealthCheckStatus {
  name: string;
  maxUnhealthy: string;
  expectedMachines: number;
  currentHealthy: number;
  remediationsAllowed: number;
  remediating: boolean;
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
  machineHealthChecks?: MachineHealthCheckStatus[];
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

const fmtTime = (ts?: string) => ts ? new Date(ts).toLocaleString() : '—';

const OperatorsTable: React.FC<{ ops: OperatorsStatus }> = ({ ops }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (name: string) => setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const sorted = [...ops.operators].sort((a, b) => {
    const rank = (o: OperatorStatus) => o.degraded ? 0 : o.progressing ? 1 : 2;
    return rank(a) - rank(b);
  });

  const th: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: T.textSubtle,
    borderBottom: `1px solid ${T.border}`,
    background: T.bgSecondary,
    whiteSpace: 'nowrap',
  };

  const condTh: React.CSSProperties = {
    ...th, background: T.dangerBg, fontSize: 10, padding: '5px 10px',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ ...th, width: 28, padding: '8px 6px' }} />
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
          const isExpanded = !!expanded[op.name];
          const hasConditions = (op.conditions?.length ?? 0) > 0;
          const tdStyle: React.CSSProperties = {
            padding: '8px 12px',
            borderBottom: isExpanded ? 'none' : `1px solid ${T.border}`,
            verticalAlign: 'top',
          };
          return (
            <React.Fragment key={op.name}>
              <tr
                onClick={() => hasConditions && toggle(op.name)}
                style={{
                  borderLeft: op.degraded || op.progressing ? `3px solid ${color}` : '3px solid transparent',
                  cursor: hasConditions ? 'pointer' : 'default',
                }}
              >
                <td style={{ ...tdStyle, padding: '8px 6px', textAlign: 'center', color: T.textMuted, fontSize: 11 }}>
                  {hasConditions ? (isExpanded ? '▾' : '▸') : ''}
                </td>
                <td style={{ ...tdStyle, fontWeight: op.degraded || op.progressing ? 600 : 400 }}>{op.name}</td>
                <td style={{ ...tdStyle, color: T.textSubtle, fontFamily: 'monospace', fontSize: 12 }}>
                  {op.version ?? '—'}
                </td>
                <td style={tdStyle}><PhaseBadge phase={op.phase} /></td>
                <td style={{ ...tdStyle, color: T.textSubtle, whiteSpace: 'nowrap' }}>
                  {fmtElapsed(op.elapsedInPhaseSeconds)}
                </td>
                <td style={{ ...tdStyle, color: T.textSubtle, fontSize: 12, wordBreak: 'break-word' }}>
                  {op.message ?? '—'}
                </td>
              </tr>

              {isExpanded && hasConditions && (
                <tr style={{ borderLeft: `3px solid ${color}`, borderBottom: `1px solid ${T.border}` }}>
                  <td colSpan={6} style={{ padding: '0 0 0 28px', background: T.bgSecondary }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={condTh}>Condition</th>
                          <th style={condTh}>Status</th>
                          <th style={condTh}>Reason</th>
                          <th style={condTh}>Since</th>
                          <th style={{ ...condTh, width: '45%' }}>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.conditions!.map((c, i) => {
                          const isUnhealthy = c.status === 'False' && ['Available'].includes(c.type)
                            || c.status === 'True' && ['Progressing', 'Degraded'].includes(c.type);
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${T.border}18` }}>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${T.border}`, fontWeight: isUnhealthy ? 700 : 400, color: isUnhealthy ? color : undefined }}>
                                {c.type}
                              </td>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${T.border}`, color: isUnhealthy ? color : T.textSubtle }}>
                                {c.status}
                              </td>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${T.border}`, color: T.textSubtle, fontFamily: 'monospace', fontSize: 11 }}>
                                {c.reason ?? '—'}
                              </td>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${T.border}`, color: T.textMuted, whiteSpace: 'nowrap' }}>
                                {fmtTime(c.since)}
                              </td>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${T.border}`, color: T.textSubtle, wordBreak: 'break-word' }}>
                                {c.message || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

// ---- Node table with drill-down -------------------------------------------

const pdbRemediation = (db: DrainBlocker): string => {
  if (db.disruptionsAllowed === 0) {
    return `PDB "${db.pdbName}" allows 0 disruptions. Scale up ${db.owner ? `"${db.owner}"` : 'the workload'} to at least ${db.desiredHealthy + 1} replicas, or temporarily increase MaxUnavailable / decrease MinAvailable.`;
  }
  return `PDB "${db.pdbName}" requires ${db.desiredHealthy} healthy pods but only ${db.currentHealthy} are ready. Wait for pods to recover or adjust the PDB.`;
};

const providerRemediation = (pe: ProviderError): string => {
  const reason = (pe.reason ?? '').toLowerCase();
  const msg    = pe.message.toLowerCase();
  if (reason.includes('iam') || msg.includes('iam') || msg.includes('unauthorized') || msg.includes('access denied')) {
    return 'Check IAM roles and instance profiles. The node may lack permissions to call EC2/EKS APIs.';
  }
  if (reason.includes('capacity') || msg.includes('capacity') || msg.includes('insufficient')) {
    return 'Instance capacity unavailable in this zone. Try a different availability zone or instance type.';
  }
  if (reason.includes('quota') || msg.includes('quota') || msg.includes('limit exceeded')) {
    return 'AWS quota exceeded. Request a limit increase via Service Quotas or free up resources.';
  }
  if (msg.includes('network') || msg.includes('vpc') || msg.includes('subnet') || msg.includes('security group')) {
    return 'Network configuration issue. Check VPC, subnets, security groups, and route tables.';
  }
  if (msg.includes('pull') || msg.includes('image') || msg.includes('registry')) {
    return 'Image pull failure. Verify pull secret validity and registry reachability from this node.';
  }
  if (msg.includes('disk') || msg.includes('storage') || msg.includes('volume') || msg.includes('ebs')) {
    return 'Storage issue. Check EBS volume limits, disk pressure, and persistent volume claims.';
  }
  return 'Review cloud provider logs or the Machine object for additional details.';
};

const NodeDetailPanel: React.FC<{ node: NodeStatus; borderColor: string }> = ({ node, borderColor }) => {
  const hasBlockers       = (node.drainBlockers?.length ?? 0) > 0;
  const hasProviderErrors = (node.providerErrors?.length ?? 0) > 0;
  const hasConditions     = (node.conditions?.length ?? 0) > 0;

  const sectionTitle: React.CSSProperties = {
    fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em',
    color: T.textSubtle, marginBottom: 6, marginTop: 10,
  };

  return (
    <div style={{ padding: '10px 12px 12px 20px', background: T.bgSecondary, fontSize: 12 }}>

      {/* PDB drain blockers */}
      {hasBlockers && (
        <>
          <div style={sectionTitle}>PDB Drain Blockers</div>
          {node.drainBlockers!.map((db, i) => (
            <div key={i} style={{
              marginBottom: 8, padding: '8px 12px',
              background: T.dangerBg,
              borderLeft: `3px solid ${T.danger}`,
              borderRadius: T.radiusSm,
            }}>
              <div style={{ fontWeight: 600, color: T.danger, marginBottom: 4 }}>
                {db.podNamespace}/{db.pdbName}
                {db.owner && <span style={{ fontWeight: 400, color: T.textSubtle, marginLeft: 8 }}>via {db.owner}</span>}
              </div>
              <div style={{ color: T.textSubtle, marginBottom: 4 }}>
                disruptions allowed: <strong>{db.disruptionsAllowed}</strong>
                {' · '}healthy: <strong>{db.currentHealthy}/{db.desiredHealthy}</strong>
                {db.violation && <span style={{ marginLeft: 8, fontFamily: 'monospace', color: T.danger }}>[{db.violation}]</span>}
              </div>
              <div style={{ color: T.warning, fontStyle: 'italic' }}>
                ⚑ {pdbRemediation(db)}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Provider / cloud errors */}
      {hasProviderErrors && (
        <>
          <div style={sectionTitle}>Cloud Provider Errors</div>
          {node.providerErrors!.map((pe, i) => (
            <div key={i} style={{
              marginBottom: 8, padding: '8px 12px',
              background: T.warningBg,
              borderLeft: `3px solid ${T.warning}`,
              borderRadius: T.radiusSm,
            }}>
              <div style={{ fontWeight: 600, color: T.warning, marginBottom: 4 }}>
                {pe.source}{pe.reason ? ` / ${pe.reason}` : ''}
              </div>
              <div style={{ color: T.textSubtle, marginBottom: 4 }}>{pe.message}</div>
              <div style={{ color: T.warning, fontStyle: 'italic' }}>
                ⚑ {providerRemediation(pe)}
              </div>
            </div>
          ))}
        </>
      )}

      {/* K8s node conditions */}
      {hasConditions && (
        <>
          <div style={sectionTitle}>Node Conditions</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Condition', 'Status', 'Reason', 'Since', 'Message'].map(h => (
                  <th key={h} style={{
                    padding: '4px 8px', textAlign: 'left', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: T.textSubtle, borderBottom: `1px solid ${T.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.conditions!.map((c, i) => {
                const isUnhealthy = (c.type === 'Ready' && c.status !== 'True')
                  || (c.type !== 'Ready' && c.status === 'True' && ['MemoryPressure','DiskPressure','PIDPressure','NetworkUnavailable'].includes(c.type));
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${T.border}18` }}>
                    <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}`, fontWeight: isUnhealthy ? 700 : 400, color: isUnhealthy ? borderColor : undefined }}>
                      {c.type}
                    </td>
                    <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}`, color: isUnhealthy ? borderColor : T.textSubtle }}>
                      {c.status}
                    </td>
                    <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}`, color: T.textSubtle, fontFamily: 'monospace' }}>
                      {c.reason ?? '—'}
                    </td>
                    <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}`, color: T.textMuted, whiteSpace: 'nowrap' }}>
                      {fmtTime(c.since)}
                    </td>
                    <td style={{ padding: '4px 8px', borderBottom: `1px solid ${T.border}`, color: T.textSubtle, wordBreak: 'break-word' }}>
                      {c.message || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {!hasBlockers && !hasProviderErrors && !hasConditions && (
        <div style={{ color: T.textMuted }}>No additional details available.</div>
      )}
    </div>
  );
};

const NodeTable: React.FC<{ nodes: NodeStatus[] }> = ({ nodes }) => {
  const [expandedNodes, setExpandedNodes] = React.useState<Record<string, boolean>>({});
  const toggleNode = (name: string) => setExpandedNodes(prev => ({ ...prev, [name]: !prev[name] }));

  const th: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: T.textSubtle,
    borderBottom: `1px solid ${T.border}`,
    background: T.bgSecondary,
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <colgroup>
        <col style={{ width: 28 }} />
        <col style={{ width: '28%' }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 90 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...th, padding: '6px 4px' }} />
          <th style={th}>Node</th>
          <th style={th}>Phase</th>
          <th style={th}>Config</th>
          <th style={th}>Elapsed</th>
          <th style={th}>Issues</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map(node => {
          const nc = phaseColor(node.phase);
          const configMatch = node.currentConfig === node.desiredConfig;
          const hasBlockers = (node.drainBlockers?.length ?? 0) > 0;
          const hasProviderErrors = (node.providerErrors?.length ?? 0) > 0;
          const hasConditions = (node.conditions?.length ?? 0) > 0;
          const hasIssues = hasBlockers || hasProviderErrors;
          const hasDetail = hasBlockers || hasProviderErrors || hasConditions;
          const isExpanded = !!expandedNodes[node.name];
          const tdBase: React.CSSProperties = {
            padding: '7px 10px',
            borderBottom: isExpanded ? 'none' : `1px solid ${T.border}`,
            verticalAlign: 'top',
          };

          return (
            <React.Fragment key={node.name}>
              <tr
                onClick={() => hasDetail && toggleNode(node.name)}
                style={{
                  borderLeft: hasIssues ? `3px solid ${nc}` : '3px solid transparent',
                  cursor: hasDetail ? 'pointer' : 'default',
                }}
              >
                <td style={{ ...tdBase, padding: '7px 4px', textAlign: 'center', color: T.textMuted, fontSize: 11 }}>
                  {hasDetail ? (isExpanded ? '▾' : '▸') : ''}
                </td>
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
                <td style={{ ...tdBase, color: T.textSubtle, whiteSpace: 'nowrap' }}>
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
                  {!hasIssues && <span style={{ color: T.textSubtle }}>—</span>}
                </td>
              </tr>

              {isExpanded && (
                <tr style={{ borderLeft: `3px solid ${nc}`, borderBottom: `1px solid ${T.border}` }}>
                  <td colSpan={6} style={{ padding: 0 }}>
                    <NodeDetailPanel node={node} borderColor={nc} />
                  </td>
                </tr>
              )}
            </React.Fragment>
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
        <NodeTable nodes={pool.nodes} />
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

// ---- MachineHealthCheck card -----------------------------------------------

const MachineHealthChecksCard: React.FC<{ mhcs: MachineHealthCheckStatus[] }> = ({ mhcs }) => {
  const [expanded, setExpanded] = React.useState(false);

  const hasIssues = mhcs.some(m => m.remediating || m.remediationsAllowed === 0 && m.expectedMachines > 0);

  const th: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: T.textSubtle, borderBottom: `1px solid ${T.border}`,
    background: T.bgSecondary, whiteSpace: 'nowrap',
  };

  const mhcStatusLabel = (m: MachineHealthCheckStatus): { label: string; color: string } => {
    if (m.expectedMachines === 0) return { label: 'No machines', color: T.textSubtle };
    if (m.remediating && m.remediationsAllowed === 0) return { label: 'Paused — threshold hit', color: T.danger };
    if (m.remediating) return { label: 'Remediating', color: T.warning };
    return { label: 'Healthy', color: T.success };
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radiusLg, overflow: 'hidden', marginBottom: 20, boxShadow: T.shadow }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '10px 16px',
          background: T.bgSecondary,
          borderBottom: expanded ? `1px solid ${T.border}` : undefined,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.textSubtle }}>
          Machine Health Checks
        </span>
        {hasIssues && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1px 8px', borderRadius: T.radiusPill,
            background: `${T.warning}22`, color: T.warning, border: `1px solid ${T.warning}55`,
            fontWeight: 600, fontSize: 11,
          }}>
            {mhcs.filter(m => m.remediating).length} remediating
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: T.textSubtle, fontSize: 12 }}>
          {mhcs.length} total · {expanded ? 'collapse ▲' : 'expand ▼'}
        </span>
      </div>

      {expanded && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={{ ...th, width: 110 }}>Max Unhealthy</th>
              <th style={{ ...th, width: 100 }}>Expected</th>
              <th style={{ ...th, width: 100 }}>Healthy</th>
              <th style={{ ...th, width: 100 }}>Allowed</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {mhcs.map(m => {
              const { label, color } = mhcStatusLabel(m);
              const unhealthy = m.expectedMachines - m.currentHealthy;
              const tdStyle: React.CSSProperties = {
                padding: '8px 12px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle',
              };
              return (
                <tr key={m.name} style={{ borderLeft: m.remediating ? `3px solid ${color}` : '3px solid transparent' }}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{m.name}</td>
                  <td style={{ ...tdStyle, color: T.textSubtle }}>{m.maxUnhealthy || '—'}</td>
                  <td style={{ ...tdStyle, color: T.textSubtle }}>{m.expectedMachines}</td>
                  <td style={{ ...tdStyle }}>
                    <span style={{ color: unhealthy > 0 ? color : T.success, fontWeight: unhealthy > 0 ? 700 : 400 }}>
                      {m.currentHealthy}
                      {unhealthy > 0 && <span style={{ fontWeight: 400, color: T.textSubtle }}> / {m.expectedMachines}</span>}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: m.remediationsAllowed === 0 && m.expectedMachines > 0 ? T.danger : T.textSubtle }}>
                    {m.remediationsAllowed}
                  </td>
                  <td style={{ ...tdStyle }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '1px 8px', borderRadius: T.radiusPill, fontSize: 12, fontWeight: 600,
                      background: `${color}22`, color, border: `1px solid ${color}55`,
                    }}>
                      {label}
                    </span>
                    {m.remediating && m.remediationsAllowed === 0 && (
                      <div style={{ fontSize: 11, color: T.danger, marginTop: 3, fontStyle: 'italic' }}>
                        Remediation paused — unhealthy machines exceed MaxUnhealthy threshold.
                        New remediations will not start until machines recover.
                      </div>
                    )}
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

  // Watch the latest UpgradeDiagsCheck CR to surface preflight issues here.
  const [diagsChecks] = useK8sWatchResource<UpgradeDiagsCheck[]>({
    groupVersionKind: { group: 'upgrade.managed.openshift.io', version: 'v1alpha1', kind: 'UpgradeDiagsCheck' },
    namespace: MUO_NS,
    isList: true,
  });
  const latestDiagsCheck = React.useMemo(() => {
    if (!Array.isArray(diagsChecks) || diagsChecks.length === 0) return null;
    return [...diagsChecks].sort((a, b) =>
      (b.metadata?.creationTimestamp ?? '').localeCompare(a.metadata?.creationTimestamp ?? '')
    )[0];
  }, [diagsChecks]);
  const preflightIssues = latestDiagsCheck?.status?.checks?.filter(
    c => c.result === 'Failed' || c.result === 'Error' || c.result === 'Warning'
  ) ?? [];

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

          {/* ---- Preflight cross-link banner ---- */}
          {preflightIssues.length > 0 && latestDiagsCheck && (
            <div style={{
              marginBottom: 20, padding: '10px 16px',
              background: preflightIssues.some(c => c.result === 'Failed' || c.result === 'Error') ? T.dangerBg : T.warningBg,
              borderLeft: `4px solid ${preflightIssues.some(c => c.result === 'Failed' || c.result === 'Error') ? T.danger : T.warning}`,
              borderRadius: T.radiusSm,
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontWeight: 700, fontSize: 13,
                  color: preflightIssues.some(c => c.result === 'Failed' || c.result === 'Error') ? T.danger : T.warning,
                  marginBottom: 4,
                }}>
                  {preflightIssues.filter(c => c.result === 'Failed' || c.result === 'Error').length > 0
                    ? `Preflight check failures may be contributing to upgrade issues`
                    : `Preflight check warnings detected`}
                </div>
                <div style={{ fontSize: 12, color: T.textSubtle }}>
                  {preflightIssues.map(c => c.name.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}
                  {' — from check run for '}
                  <strong>{latestDiagsCheck.spec?.desired?.version}</strong>
                  {'. See the '}
                  <strong>Diagnostics Checks</strong>
                  {' tab for details and remediation steps.'}
                </div>
              </div>
            </div>
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

          {/* ---- Machine Health Checks ---- */}
          {snapshot.machineHealthChecks && snapshot.machineHealthChecks.length > 0 && (
            <MachineHealthChecksCard mhcs={snapshot.machineHealthChecks} />
          )}
        </>
      )}
    </div>
  );
};

export default UpgradeStatusView;
