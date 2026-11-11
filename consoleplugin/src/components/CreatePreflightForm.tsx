import * as React from 'react';
import {
  Modal, ModalVariant, Button, Form, FormGroup,
  FormSelect, FormSelectOption, TextInput,
  FormHelperText, HelperText, HelperTextItem,
  Alert, Spinner,
} from '@patternfly/react-core';
import { consoleFetch, useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';

const PREFLIGHT_API = '/api/plugins/managed-upgrade-operator/api/v1/preflight-checks';

interface ClusterVersion {
  spec?: { channel?: string };
  status?: {
    desired?: { version?: string };
    history?: Array<{ version: string; state: string }>;
    availableUpdates?: Array<{ version: string }>;
    conditionalUpdates?: Array<{ release: { version: string }; risks?: Array<{ name: string }> }>;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CHANNEL_RE = /^(stable|fast|candidate|eus)-\d+\.\d+$/;

export const CreatePreflightForm: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [version, setVersion] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [platform, setPlatform] = React.useState<'OSD' | 'ARO'>('OSD');
  const [description, setDescription] = React.useState('');
  const [useCustomVersion, setUseCustomVersion] = React.useState(false);
  const [useCustomChannel, setUseCustomChannel] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [cv, cvLoaded, cvError] = useK8sWatchResource<ClusterVersion>({
    groupVersionKind: { group: 'config.openshift.io', version: 'v1', kind: 'ClusterVersion' },
    name: 'version',
  });

  // Derive cluster state
  const currentVersion = cv?.status?.desired?.version
    ?? cv?.status?.history?.find(h => h.state === 'Completed')?.version
    ?? '';
  const currentChannel = cv?.spec?.channel ?? '';
  const availableUpdates = cv?.status?.availableUpdates ?? [];
  const conditionalUpdates = cv?.status?.conditionalUpdates ?? [];

  // Parse current channel for sibling channel suggestions
  const channelMatch = currentChannel.match(/^(stable|fast|candidate|eus)-(\d+\.\d+)$/);
  const channelXY = channelMatch?.[2] ?? '';

  // Seed channel from cluster when form first opens
  React.useEffect(() => {
    if (isOpen && currentChannel && !channel) {
      setChannel(currentChannel);
    }
  }, [isOpen, currentChannel]);

  const versionError = version && !SEMVER_RE.test(version) ? 'Version must be in X.Y.Z format (e.g. 4.22.22)' : '';
  const channelError = channel && !CHANNEL_RE.test(channel) ? 'Channel must be in {type}-X.Y format (e.g. stable-4.22)' : '';
  const canSubmit = version && channel && !versionError && !channelError && !submitting;

  const resetForm = () => {
    setVersion('');
    setChannel(currentChannel);
    setDescription('');
    setUseCustomVersion(false);
    setUseCustomChannel(false);
    setError(null);
  };

  const handleClose = () => { resetForm(); onClose(); };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await consoleFetch(PREFLIGHT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVersion: version,
          targetChannel: channel,
          platform,
          ...(description ? { description } : {}),
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      resetForm();
      onClose();
      onCreated();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      variant={ModalVariant.small}
      title="Run Upgrade Preflight Checks"
      isOpen={isOpen}
      onClose={handleClose}
      appendTo={() => document.body}
      actions={[
        <Button key="run" variant="primary" isLoading={submitting} isDisabled={!canSubmit} onClick={handleSubmit}>
          Run Checks
        </Button>,
        <Button key="cancel" variant="link" onClick={handleClose} isDisabled={submitting}>
          Cancel
        </Button>,
      ]}
    >
      <Form>
        {currentVersion && (
          <Alert variant="info" isInline title={`Current cluster version: ${currentVersion}`} />
        )}
        {error && <Alert variant="danger" isInline title="Error creating preflight check">{error}</Alert>}

        {/* ── Version ── */}
        <FormGroup label="Target Version" isRequired fieldId="version">
          {!cvLoaded && <><Spinner size="sm" /> Loading available versions…</>}

          {cvLoaded && !cvError && !useCustomVersion && (
            <>
              <FormSelect
                id="version"
                value={version}
                onChange={(_e, v) => {
                  if (v === '__custom__') { setUseCustomVersion(true); setVersion(''); }
                  else setVersion(v);
                }}
                aria-label="Select target version"
              >
                <FormSelectOption value="" label="Select a version…" isPlaceholder />
                {currentVersion && (
                  <FormSelectOption value={currentVersion} label={`${currentVersion} (current, disabled)`} isDisabled />
                )}
                {availableUpdates.length > 0 && (
                  <>
                    <FormSelectOption value="" label="— Available Updates —" isDisabled />
                    {availableUpdates.map(u => (
                      <FormSelectOption key={u.version} value={u.version} label={u.version} />
                    ))}
                  </>
                )}
                {conditionalUpdates.length > 0 && (
                  <>
                    <FormSelectOption value="" label="— May Have Risks —" isDisabled />
                    {conditionalUpdates.map(u => (
                      <FormSelectOption
                        key={u.release.version}
                        value={u.release.version}
                        label={`${u.release.version} ⚠️${u.risks?.[0]?.name ? ` — ${u.risks[0].name}` : ''}`}
                      />
                    ))}
                  </>
                )}
                <FormSelectOption value="" label="—" isDisabled />
                <FormSelectOption value="__custom__" label="Custom version…" />
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {availableUpdates.length === 0 && conditionalUpdates.length === 0 && currentVersion
                      ? 'Cluster is on the latest version. Use "Custom version…" to test any target.'
                      : 'Select from available upgrade targets or choose a custom version.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </>
          )}

          {/* Fallback or custom text input */}
          {cvLoaded && (cvError || useCustomVersion) && (
            <>
              {cvError && <Alert variant="warning" isInline title="Unable to load available versions — enter manually" />}
              <TextInput
                id="version-custom"
                value={version}
                onChange={(_e, v) => setVersion(v)}
                placeholder="e.g. 4.22.22"
                validated={versionError ? 'error' : 'default'}
                isRequired
              />
              {useCustomVersion && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {versionError || <Button variant="link" isInline onClick={() => { setUseCustomVersion(false); setVersion(''); }}>← Back to version list</Button>}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
              {!useCustomVersion && versionError && (
                <FormHelperText>
                  <HelperText><HelperTextItem variant="error">{versionError}</HelperTextItem></HelperText>
                </FormHelperText>
              )}
            </>
          )}
        </FormGroup>

        {/* ── Channel ── */}
        <FormGroup label="Target Channel" isRequired fieldId="channel">
          {!useCustomChannel ? (
            <>
              <FormSelect
                id="channel"
                value={channel}
                onChange={(_e, v) => {
                  if (v === '__custom__') { setUseCustomChannel(true); setChannel(''); }
                  else setChannel(v);
                }}
                aria-label="Select target channel"
              >
                <FormSelectOption value="" label="Select a channel…" isPlaceholder />
                {currentChannel && (
                  <FormSelectOption value={currentChannel} label={`${currentChannel} (current)`} />
                )}
                {channelXY && (
                  <>
                    <FormSelectOption value="" label="— Common Channels —" isDisabled />
                    {['stable', 'fast', 'candidate'].map(t => {
                      const c = `${t}-${channelXY}`;
                      return c !== currentChannel
                        ? <FormSelectOption key={c} value={c} label={c} />
                        : null;
                    })}
                  </>
                )}
                <FormSelectOption value="" label="—" isDisabled />
                <FormSelectOption value="__custom__" label="Custom channel…" />
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {channelError
                      ? <span style={{ color: 'var(--pf-v5-global--danger-color--100)' }}>{channelError}</span>
                      : 'Update channel — stable (production), fast (early access), candidate (pre-release)'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </>
          ) : (
            <>
              <TextInput
                id="channel-custom"
                value={channel}
                onChange={(_e, v) => setChannel(v)}
                placeholder="e.g. stable-4.22"
                validated={channelError ? 'error' : 'default'}
                isRequired
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={channelError ? 'error' : 'default'}>
                    {channelError || <Button variant="link" isInline onClick={() => { setUseCustomChannel(false); setChannel(currentChannel); }}>← Back to channel list</Button>}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </>
          )}
        </FormGroup>

        {/* ── Platform ── */}
        <FormGroup label="Platform" isRequired fieldId="platform">
          <FormSelect id="platform" value={platform} onChange={(_e, v) => setPlatform(v as 'OSD' | 'ARO')}>
            <FormSelectOption value="OSD" label="OpenShift Dedicated (OSD)" />
            <FormSelectOption value="ARO" label="Azure Red Hat OpenShift (ARO)" />
          </FormSelect>
        </FormGroup>

        {/* ── Description (optional) ── */}
        <FormGroup label="Description" fieldId="description">
          <TextInput
            id="description"
            value={description}
            onChange={(_e, v) => setDescription(v)}
            placeholder="e.g. Pre-upgrade validation for Q4 maintenance window"
          />
          <FormHelperText>
            <HelperText><HelperTextItem>Optional label stored with this check run</HelperTextItem></HelperText>
          </FormHelperText>
        </FormGroup>
      </Form>
    </Modal>
  );
};
