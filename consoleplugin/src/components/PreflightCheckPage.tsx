import * as React from 'react';
import {
  Page, PageSection, PageSectionVariants, Title,
  Button, Spinner, Alert, EmptyState, EmptyStateBody, Label,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { TrashIcon, SyncAltIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { useK8sWatchResource, consoleFetch } from '@openshift-console/dynamic-plugin-sdk';
import { type UpgradePreflightCheck } from '../types';
import { StatusBadge } from './StatusBadge';
import { PreflightCheckDetail } from './PreflightCheckDetail';
import { CreatePreflightForm, type InitialValues } from './CreatePreflightForm';

const MUO_NS = 'openshift-managed-upgrade-operator';
const REQUEST_ID_LABEL = 'preflight.managed.openshift.io/request-id';
const DESCRIPTION_ANNOTATION = 'preflight.managed.openshift.io/description';
const PROXY_BASE = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/preflight-checks';

const relativeTime = (ts?: string): string => {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(ts).toLocaleDateString();
};

// Left border color gives instant row-level severity at a glance
const rowBorderColor = (result?: string): string => {
  if (result === 'Failed') return 'var(--pf-v5-global--palette--red-200)';
  if (result === 'Error')  return 'var(--pf-v5-global--palette--orange-300)';
  if (result === 'Warning') return 'var(--pf-v5-global--palette--gold-300)';
  if (result === 'Passed') return 'var(--pf-v5-global--palette--green-300)';
  return 'transparent';
};

const CheckSummary: React.FC<{ pfc: UpgradePreflightCheck }> = ({ pfc }) => {
  const s = pfc.status;
  if (!s || (!s.completedAt && !s.startedAt)) {
    return <Spinner size="sm" aria-label="Waiting to start" />;
  }
  if (s.startedAt && !s.completedAt) {
    const done = (s.checksPassed ?? 0) + (s.checksFailed ?? 0) + (s.checksErrored ?? 0) + (s.checksWarned ?? 0);
    const total = s.checks?.length ?? 0;
    return (
      <span style={{ color: 'var(--pf-v5-global--info-color--100)' }}>
        Running{total > 0 ? ` (${done} / ${total})` : '…'}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {(s.checksPassed ?? 0) > 0 && (
        <Label color="green" isCompact>{s.checksPassed} passed</Label>
      )}
      {(s.checksFailed ?? 0) > 0 && (
        <Label color="red" isCompact>{s.checksFailed} failed</Label>
      )}
      {(s.checksErrored ?? 0) > 0 && (
        <Label color="orange" isCompact>{s.checksErrored} {s.checksErrored === 1 ? 'error' : 'errors'}</Label>
      )}
      {(s.checksWarned ?? 0) > 0 && (
        <Label color="gold" isCompact>{s.checksWarned} {s.checksWarned === 1 ? 'warning' : 'warnings'}</Label>
      )}
    </div>
  );
};

export const PreflightCheckPage: React.FC = () => {
  const [createOpen, setCreateOpen]   = React.useState(false);
  const [createInitial, setCreateInitial] = React.useState<InitialValues | undefined>();
  const [expanded, setExpanded]       = React.useState<Record<string, boolean>>({});
  const [deleting, setDeleting]       = React.useState<Record<string, boolean>>({});
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const [checks, loaded, loadError] = useK8sWatchResource<UpgradePreflightCheck[]>({
    groupVersionKind: { group: 'upgrade.managed.openshift.io', version: 'v1alpha1', kind: 'UpgradePreflightCheck' },
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

  const handleDelete = async (pfc: UpgradePreflightCheck) => {
    const name = pfc.metadata?.name ?? '';
    const requestId = pfc.metadata?.labels?.[REQUEST_ID_LABEL];
    if (!requestId) {
      setDeleteError(`"${name}" was not created via the HTTP API and cannot be deleted here.`);
      return;
    }
    setDeleting(prev => ({ ...prev, [name]: true }));
    setDeleteError(null);
    try {
      await consoleFetch(`${PROXY_BASE}/${requestId}`, { method: 'DELETE' });
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(prev => ({ ...prev, [name]: false }));
    }
  };

  const handleRerun = (pfc: UpgradePreflightCheck) => {
    openCreate({
      version:     pfc.spec.desired.version,
      channel:     pfc.spec.desired.channel,
      platform:    pfc.spec.type,
      description: pfc.metadata?.annotations?.[DESCRIPTION_ANNOTATION] ?? '',
    });
  };

  return (
    <Page>
      <PageSection variant={PageSectionVariants.light}>
        <Title headingLevel="h1">Upgrade Preflight Checks</Title>
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

        {loaded && !loadError && sorted.length === 0 && (
          <EmptyState>
            <EmptyStateBody>
              Run preflight checks before upgrading to validate cluster readiness.
            </EmptyStateBody>
            <Button variant="primary" onClick={() => openCreate()} style={{ marginTop: 16 }}>
              Run New Check
            </Button>
          </EmptyState>
        )}

        {loaded && sorted.length > 0 && (
          <Table aria-label="Upgrade preflight checks" style={{ width: '100%' }}>
            <Thead>
              <Tr>
                <Th style={{ width: 32 }} />
                <Th style={{ minWidth: 180 }}>Target</Th>
                <Th style={{ width: 120 }}>Result</Th>
                <Th style={{ minWidth: 220 }}>Checks</Th>
                <Th style={{ width: 130 }}>Started</Th>
                <Th style={{ width: 90 }} />
              </Tr>
            </Thead>
            <Tbody>
              {sorted.map((pfc, rowIndex) => {
                const name        = pfc.metadata?.name ?? '';
                const isExpanded  = !!expanded[name];
                const isDeleting  = !!deleting[name];
                const description = pfc.metadata?.annotations?.[DESCRIPTION_ANNOTATION];
                const borderColor = rowBorderColor(pfc.status?.overallResult);

                return (
                  <React.Fragment key={name}>
                    <Tr
                      style={{
                        cursor: 'pointer',
                        borderLeft: `4px solid ${borderColor}`,
                      }}
                      onClick={() => toggle(name)}
                    >
                      <Td
                        expand={{ isExpanded, onToggle: () => toggle(name), rowIndex }}
                        onClick={e => e.stopPropagation()}
                      />
                      <Td>
                        <div style={{ fontWeight: 600, fontSize: 'var(--pf-v5-global--FontSize--md)' }}>
                          {pfc.spec.desired.version}
                        </div>
                        <div style={{ fontSize: 'var(--pf-v5-global--FontSize--sm)', color: 'var(--pf-v5-global--Color--200)' }}>
                          {pfc.spec.desired.channel}
                        </div>
                        {description && (
                          <div style={{ fontSize: 'var(--pf-v5-global--FontSize--sm)', color: 'var(--pf-v5-global--Color--200)', marginTop: 2 }}>
                            {description}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {pfc.status?.overallResult
                          ? <StatusBadge result={pfc.status.overallResult} />
                          : <Spinner size="sm" />}
                      </Td>
                      <Td><CheckSummary pfc={pfc} /></Td>
                      <Td style={{ color: 'var(--pf-v5-global--Color--200)' }}>
                        {relativeTime(pfc.metadata?.creationTimestamp)}
                      </Td>
                      <Td
                        onClick={e => e.stopPropagation()}
                        style={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                      >
                        <Button
                          variant="plain"
                          aria-label="Re-run with same settings"
                          title="Re-run with same settings"
                          onClick={() => handleRerun(pfc)}
                          isDisabled={isDeleting}
                        >
                          <SyncAltIcon />
                        </Button>
                        <Button
                          variant="plain"
                          aria-label="Delete this check run"
                          title="Delete"
                          onClick={() => handleDelete(pfc)}
                          isDisabled={isDeleting}
                          style={{ color: isDeleting ? undefined : 'var(--pf-v5-global--palette--red-200)' }}
                        >
                          {isDeleting ? <Spinner size="sm" /> : <TrashIcon />}
                        </Button>
                      </Td>
                    </Tr>
                    {isExpanded && (
                      <Tr isExpanded>
                        <Td colSpan={6} style={{ paddingTop: 0 }}>
                          <PreflightCheckDetail pfc={pfc} />
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
                );
              })}

              <Tr>
                <Td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
                    padding: '12px 0',
                  }}
                >
                  <Button variant="link" icon={<PlusCircleIcon />} onClick={() => openCreate()}>
                    Run New Check
                  </Button>
                </Td>
              </Tr>
            </Tbody>
          </Table>
        )}
      </PageSection>

      <CreatePreflightForm
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
        initialValues={createInitial}
      />
    </Page>
  );
};

export default PreflightCheckPage;
