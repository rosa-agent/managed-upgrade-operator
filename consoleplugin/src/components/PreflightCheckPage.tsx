import * as React from 'react';
import {
  Page, PageSection, PageSectionVariants, Title,
  Button, Toolbar, ToolbarContent, ToolbarItem,
  EmptyState, EmptyStateBody,
  Spinner, Alert,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { type UpgradePreflightCheck } from '../types';
import { StatusBadge } from './StatusBadge';
import { PreflightCheckDetail } from './PreflightCheckDetail';
import { CreatePreflightForm } from './CreatePreflightForm';

const MUO_NS = 'openshift-managed-upgrade-operator';

export const PreflightCheckPage: React.FC = () => {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const [checks, loaded, error] = useK8sWatchResource<UpgradePreflightCheck[]>({
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
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <Page>
      <PageSection variant={PageSectionVariants.light}>
        <Title headingLevel="h1">Upgrade Preflight Checks</Title>
      </PageSection>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>Run New Check</Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        {!loaded && <Spinner />}
        {error && <Alert variant="danger" title="Failed to load preflight checks">{String(error)}</Alert>}
        {loaded && !error && sorted.length === 0 && (
          <EmptyState>
            <EmptyStateBody>
              Run preflight checks before upgrading to validate cluster readiness.
            </EmptyStateBody>
            <Button variant="primary" onClick={() => setCreateOpen(true)} style={{ marginTop: 16 }}>
              Run New Check
            </Button>
          </EmptyState>
        )}
        {loaded && sorted.length > 0 && (
          <Table aria-label="Preflight checks">
            <Thead>
              <Tr>
                <Th />
                <Th>Name</Th>
                <Th>Version</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th>Passed</Th>
                <Th>Warned</Th>
                <Th>Failed</Th>
                <Th>Errored</Th>
                <Th>Created</Th>
                <Th>Completed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sorted.map((pfc, rowIndex) => {
                const s = pfc.status ?? {};
                const name = pfc.metadata?.name ?? '';
                const isExpanded = !!expanded[name];
                return (
                  <React.Fragment key={name}>
                    <Tr>
                      <Td
                        expand={{ isExpanded, onToggle: () => toggle(name), rowIndex }}
                      />
                      <Td>{name}</Td>
                      <Td>{pfc.spec.desired.version}</Td>
                      <Td>{pfc.spec.desired.channel}</Td>
                      <Td>{s.overallResult ? <StatusBadge result={s.overallResult} /> : <Spinner size="sm" />}</Td>
                      <Td>{s.checksPassed ?? '—'}</Td>
                      <Td>{s.checksWarned ?? '—'}</Td>
                      <Td>{s.checksFailed ?? '—'}</Td>
                      <Td>{s.checksErrored ?? '—'}</Td>
                      <Td>{pfc.metadata?.creationTimestamp ? new Date(pfc.metadata.creationTimestamp).toLocaleString() : '—'}</Td>
                      <Td>{s.completedAt ? new Date(s.completedAt).toLocaleString() : '—'}</Td>
                    </Tr>
                    {isExpanded && (
                      <Tr isExpanded>
                        <Td colSpan={11}>
                          {s.checks ? (
                            <PreflightCheckDetail checks={s.checks} />
                          ) : (
                            <Spinner />
                          )}
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>

      <CreatePreflightForm
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
      />
    </Page>
  );
};

export default PreflightCheckPage;
