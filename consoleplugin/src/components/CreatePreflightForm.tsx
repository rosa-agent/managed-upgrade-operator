import * as React from 'react';
import {
  Modal, ModalVariant, Button, Form, FormGroup,
  TextInput, FormSelect, FormSelectOption, ActionGroup,
  Alert, FormHelperText, HelperText, HelperTextItem,
} from '@patternfly/react-core';
import { k8sCreate, useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import type { UpgradePreflightCheck } from '../types';

const MUO_NS = 'openshift-managed-upgrade-operator';

const PREFLIGHT_MODEL = {
  apiVersion: 'upgrade.managed.openshift.io/v1alpha1',
  kind: 'UpgradePreflightCheck',
  plural: 'upgradepreflightchecks',
  namespaced: true,
  abbr: 'PFC',
  label: 'Preflight Check',
  labelPlural: 'Preflight Checks',
  group: 'upgrade.managed.openshift.io',
  version: 'v1alpha1',
};

interface ClusterVersion {
  spec?: { channel?: string };
  status?: {
    history?: Array<{ version: string; state: string }>;
    availableUpdates?: Array<{ version: string }>;
    conditionalUpdates?: Array<{ release: { version: string } }>;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CHANNEL_RE = /^(stable|fast|candidate|eus)-\d+\.\d+$/;

export const CreatePreflightForm: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [version, setVersion] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [platform, setPlatform] = React.useState<'OSD' | 'ARO'>('OSD');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [cv] = useK8sWatchResource<ClusterVersion>({
    groupVersionKind: { group: 'config.openshift.io', version: 'v1', kind: 'ClusterVersion' },
    name: 'version',
  });

  const currentVersion = cv?.status?.history?.find(h => h.state === 'Completed')?.version ?? '';
  const currentChannel = cv?.spec?.channel ?? '';

  const availableVersions = React.useMemo(() => {
    const versions = new Set<string>();
    cv?.status?.availableUpdates?.forEach(u => versions.add(u.version));
    cv?.status?.conditionalUpdates?.forEach(u => versions.add(u.release.version));
    return Array.from(versions).sort();
  }, [cv]);

  // Seed channel from cluster when form first opens
  React.useEffect(() => {
    if (isOpen && currentChannel && !channel) {
      setChannel(currentChannel);
    }
  }, [isOpen, currentChannel]);

  const versionError = version && !SEMVER_RE.test(version) ? 'Version must be in X.Y.Z format (e.g. 4.22.22)' : '';
  const channelError = channel && !CHANNEL_RE.test(channel) ? 'Channel must be in {type}-X.Y format (e.g. stable-4.22)' : '';
  const canSubmit = version && channel && !versionError && !channelError && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const cr: Partial<UpgradePreflightCheck> = {
        apiVersion: 'upgrade.managed.openshift.io/v1alpha1',
        kind: 'UpgradePreflightCheck',
        metadata: {
          generateName: 'preflight-',
          namespace: MUO_NS,
          ...(description ? { annotations: { 'preflight.managed.openshift.io/description': description } } : {}),
        } as any,
        spec: {
          type: platform,
          desired: { version, channel },
        },
      };

      const created = await k8sCreate({ model: PREFLIGHT_MODEL as any, data: cr as any });
      onCreated((created as any).metadata.name);
      setVersion('');
      setChannel(currentChannel);
      setDescription('');
      setError(null);
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const availableHint = availableVersions.length > 0
    ? `Available updates: ${availableVersions.join(', ')}`
    : currentVersion
    ? 'No updates available from CVO — you can still run checks against any version'
    : '';

  return (
    <Modal
      variant={ModalVariant.small}
      title="Run Upgrade Preflight Checks"
      isOpen={isOpen}
      onClose={onClose}
      appendTo={() => document.body}
      actions={[
        <Button
          key="run"
          variant="primary"
          isLoading={submitting}
          isDisabled={!canSubmit}
          onClick={handleSubmit}
        >
          Run Checks
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>,
      ]}
    >
      <Form>
        {currentVersion && (
          <Alert variant="info" isInline title={`Current cluster version: ${currentVersion}`} />
        )}
        {error && <Alert variant="danger" isInline title="Error creating preflight check">{error}</Alert>}

        <FormGroup label="Target Version" isRequired fieldId="version">
          <TextInput
            id="version"
            value={version}
            onChange={(_e, v) => setVersion(v)}
            placeholder="e.g. 4.22.22"
            validated={versionError ? 'error' : 'default'}
            isRequired
          />
          <FormHelperText>
            <HelperText>
              {versionError ? (
                <HelperTextItem variant="error">{versionError}</HelperTextItem>
              ) : availableHint ? (
                <HelperTextItem>{availableHint}</HelperTextItem>
              ) : (
                <HelperTextItem>Target OpenShift version to validate upgrade readiness for</HelperTextItem>
              )}
            </HelperText>
          </FormHelperText>
        </FormGroup>

        <FormGroup label="Target Channel" isRequired fieldId="channel">
          <TextInput
            id="channel"
            value={channel}
            onChange={(_e, v) => setChannel(v)}
            placeholder="e.g. stable-4.22"
            validated={channelError ? 'error' : 'default'}
            isRequired
          />
          <FormHelperText>
            <HelperText>
              {channelError ? (
                <HelperTextItem variant="error">{channelError}</HelperTextItem>
              ) : (
                <HelperTextItem>Update channel — stable, fast, or candidate (e.g. stable-4.22)</HelperTextItem>
              )}
            </HelperText>
          </FormHelperText>
        </FormGroup>

        <FormGroup label="Platform" isRequired fieldId="platform">
          <FormSelect
            id="platform"
            value={platform}
            onChange={(_e, v) => setPlatform(v as 'OSD' | 'ARO')}
          >
            <FormSelectOption value="OSD" label="OpenShift Dedicated (OSD)" />
            <FormSelectOption value="ARO" label="Azure Red Hat OpenShift (ARO)" />
          </FormSelect>
        </FormGroup>

        <FormGroup label="Description" fieldId="description">
          <TextInput
            id="description"
            value={description}
            onChange={(_e, v) => setDescription(v)}
            placeholder="e.g. Pre-upgrade validation for Q4 maintenance window"
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem>Optional label for this check run</HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>
      </Form>
    </Modal>
  );
};
