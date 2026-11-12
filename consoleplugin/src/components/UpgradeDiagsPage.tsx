import * as React from 'react';
import {
  Page, PageSection, PageSectionVariants, Title,
  Button, Spinner, Alert, EmptyState, EmptyStateBody,
} from '@patternfly/react-core';
import { TrashIcon, SyncAltIcon, PlusCircleIcon, CaretDownIcon, CaretRightIcon } from '@patternfly/react-icons';
import { useK8sWatchResource, consoleFetch } from '@openshift-console/dynamic-plugin-sdk';
import { type UpgradeDiagsCheck } from '../types';
import { StatusBadge } from './StatusBadge';
import { UpgradeDiagsDetail } from './UpgradeDiagsDetail';
import { CreateDiagsCheckForm, type InitialValues } from './CreateDiagsCheckForm';

const MUO_NS = 'openshift-managed-upgrade-operator';
const UPGRADEDIAGS_REQUEST_ID_LABEL = 'upgradediags.managed.openshift.io/request-id';
const UPGRADEDIAGS_DESCRIPTION_ANNOTATION = 'upgradediags.managed.openshift.io/description';
const UPGRADEDIAGS_PROXY_BASE = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/upgrade-diags';

const relativeTime = (ts?: string): string => {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(ts).toLocaleDateString();
};

// Row border color keyed on overall result
const resultBorder = (r?: string) => {
  if (r === 'Failed')  return '#c9190b';
  if (r === 'Error')   return '#c95f0b';
  if (r === 'Warning') return '#c58c00';
  if (r === 'Passed')  return '#5ba352';
  return 'transparent';
};

// Inline-styled colored summary counts — no PF CSS class dependency
const CheckSummary: React.FC<{ pfc: UpgradeDiagsCheck }> = ({ pfc }) => {
  const s = pfc.status;
  if (!s || (!s.completedAt && !s.startedAt)) {
    return <Spinner size="sm" aria-label="Waiting to start" />;
  }
  if (s.startedAt && !s.completedAt) {
    const done = (s.checksPassed ?? 0) + (s.checksFailed ?? 0) + (s.checksErrored ?? 0) + (s.checksWarned ?? 0);
    const total = s.checks?.length ?? 0;
    return <span style={{ color: '#73bcf7' }}>Running{total > 0 ? ` (${done}/${total})` : '…'}</span>;
  }

  const pills: Array<[number | undefined, string, string]> = [
    [s.checksPassed,  'passed',  '#5ba352'],
    [s.checksFailed,  'failed',  '#c9190b'],
    [s.checksErrored, (s.checksErrored ?? 0) === 1 ? 'error' : 'errors', '#c95f0b'],
    [s.checksWarned,  (s.checksWarned  ?? 0) === 1 ? 'warning' : 'warnings', '#c58c00'],
  ];

  return (
    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {pills.filter(([n]) => (n ?? 0) > 0).map(([n, label, color]) => (
        <span key={label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px', borderRadius: 20,
          background: `${color}22`, color, border: `1px solid ${color}55`,
          fontWeight: 600, fontSize: 12,
        }}>
          {n} {label}
        </span>
      ))}
    </span>
  );
};

export const UpgradeDiagsPage: React.FC = () => {
  const [createOpen, setCreateOpen]       = React.useState(false);
  const [createInitial, setCreateInitial] = React.useState<InitialValues | undefined>();
  const [expanded, setExpanded]           = React.useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow]       = React.useState<string | null>(null);
  const [deleting, setDeleting]           = React.useState<Record<string, boolean>>({});
  const [deleteError, setDeleteError]     = React.useState<string | null>(null);

  const [checks, loaded, loadError] = useK8sWatchResource<UpgradeDiagsCheck[]>({
    groupVersionKind: { group: 'upgrade.managed.openshift.io', version: 'v1alpha1', kind: 'UpgradeDiagsCheck' },
    namespace: MUO_NS,
    isList: true,
  });

  const sorted = React.useMemo(
    () => [...(checks ?? [])].sort((a, b) =>
      (b.metadata?.creationTimestamp ?? '').localeCompare(a.metadata?.creationTimestamp ?? '')
    ),
    [checks],
  );

  const toggle = (name: string) =>
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const openCreate = (initial?: InitialValues) => {
    setCreateInitial(initial);
    setCreateOpen(true);
  };

  const handleDelete = async (pfc: UpgradeDiagsCheck) => {
    const name = pfc.metadata?.name ?? '';
    const requestId = pfc.metadata?.labels?.[UPGRADEDIAGS_REQUEST_ID_LABEL];
    if (!requestId) {
      setDeleteError(`"${name}" was not created via the HTTP API and cannot be deleted here.`);
      return;
    }
    setDeleting(prev => ({ ...prev, [name]: true }));
    setDeleteError(null);
    try {
      await consoleFetch(`${UPGRADEDIAGS_PROXY_BASE}/${requestId}`, { method: 'DELETE' });
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(prev => ({ ...prev, [name]: false }));
    }
  };

  const handleRerun = (pfc: UpgradeDiagsCheck) => {
    openCreate({
      version:     pfc.spec.desired.version,
      channel:     pfc.spec.desired.channel,
      platform:    pfc.spec.type,
      description: pfc.metadata?.annotations?.[UPGRADEDIAGS_DESCRIPTION_ANNOTATION] ?? '',
    });
  };

  // Card container style for visual depth
  const cardStyle: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  };

  const thStyle: React.CSSProperties = {
    padding: '10px 16px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.5)',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    whiteSpace: 'nowrap',
  };

  return (
    <Page>
      <PageSection variant={PageSectionVariants.light}>
        <Title headingLevel="h1">Upgrade Diagnostics</Title>
      </PageSection>

      <PageSection>
        {deleteError && (
          <Alert variant="warning" isInline title="Delete failed" style={{ marginBottom: 16 }}>
            {deleteError}
          </Alert>
        )}
        {loadError && (
          <Alert variant="warning" isInline title="Failed to load checks">
            {String(loadError)}
          </Alert>
        )}
        {!loaded && <Spinner />}

        {loaded && !loadError && sorted.length === 0 && !createOpen && (
          <EmptyState>
            <EmptyStateBody>
              Run upgrade upgrade diags checks to validate cluster health before upgrading.
            </EmptyStateBody>
            <Button variant="primary" onClick={() => openCreate()} style={{ marginTop: 16 }}>
              Run New Check
            </Button>
          </EmptyState>
        )}

        {loaded && sorted.length > 0 && (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ minWidth: 180 }} />
                <col style={{ width: 120 }} />
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 90 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={thStyle} />
                  <th style={thStyle}>Target</th>
                  <th style={thStyle}>Result</th>
                  <th style={thStyle}>Checks</th>
                  <th style={thStyle}>Started</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((pfc) => {
                  const name        = pfc.metadata?.name ?? '';
                  const isExpanded  = !!expanded[name];
                  const isDeleting  = !!deleting[name];
                  const isHovered   = hoveredRow === name;
                  const description = pfc.metadata?.annotations?.[UPGRADEDIAGS_DESCRIPTION_ANNOTATION];
                  const border      = resultBorder(pfc.status?.overallResult);

                  const rowBg = isExpanded
                    ? 'rgba(255,255,255,0.05)'
                    : isHovered
                    ? 'rgba(255,255,255,0.03)'
                    : 'transparent';

                  const tdStyle: React.CSSProperties = {
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    verticalAlign: 'middle',
                    background: rowBg,
                    transition: 'background 0.1s',
                  };

                  return (
                    <React.Fragment key={name}>
                      <tr
                        style={{ cursor: 'pointer', borderLeft: `4px solid ${border}` }}
                        onClick={() => toggle(name)}
                        onMouseEnter={() => setHoveredRow(name)}
                        onMouseLeave={() => setHoveredRow(null)}
                      >
                        <td style={{ ...tdStyle, padding: '12px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                          {isExpanded ? <CaretDownIcon /> : <CaretRightIcon />}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{pfc.spec.desired.version}</div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                            {pfc.spec.desired.channel}
                          </div>
                          {description && (
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2, fontStyle: 'italic' }}>
                              {description}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {pfc.status?.overallResult
                            ? <StatusBadge result={pfc.status.overallResult} />
                            : <Spinner size="sm" />}
                        </td>
                        <td style={tdStyle}><CheckSummary pfc={pfc} /></td>
                        <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                          {relativeTime(pfc.metadata?.creationTimestamp)}
                        </td>
                        <td
                          style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <Button
                            variant="plain"
                            aria-label="Re-run with same settings"
                            title="Re-run with same settings"
                            onClick={() => handleRerun(pfc)}
                            isDisabled={isDeleting}
                            style={{ color: 'rgba(255,255,255,0.5)' }}
                          >
                            <SyncAltIcon />
                          </Button>
                          <Button
                            variant="plain"
                            aria-label="Delete this check run"
                            title="Delete"
                            onClick={() => handleDelete(pfc)}
                            isDisabled={isDeleting}
                            style={{ color: isDeleting ? 'rgba(255,255,255,0.3)' : '#c9190b' }}
                          >
                            {isDeleting ? <Spinner size="sm" /> : <TrashIcon />}
                          </Button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              borderLeft: `4px solid ${border}`,
                              borderBottom: '1px solid rgba(255,255,255,0.07)',
                              padding: 0,
                              background: 'rgba(255,255,255,0.02)',
                            }}
                          >
                            <UpgradeDiagsDetail pfc={pfc} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Run New Check row */}
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                      borderTop: sorted.length > 0 ? '1px solid rgba(255,255,255,0.07)' : undefined,
                    }}
                  >
                    {!createOpen ? (
                      <Button
                        variant="link"
                        icon={<PlusCircleIcon />}
                        onClick={() => openCreate()}
                      >
                        Run New Check
                      </Button>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                        Fill in the form below to run a new check
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Inline form panel — no Modal, stays within iframe bounds */}
        <CreateDiagsCheckForm
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
          initialValues={createInitial}
        />
      </PageSection>
    </Page>
  );
};

export default UpgradeDiagsPage;
