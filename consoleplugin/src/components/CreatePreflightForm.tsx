import * as React from 'react';
import {
  Button, Form, FormGroup, FormSelect, FormSelectOption,
  FormHelperText, HelperText, HelperTextItem, TextInput, Spinner,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
import { consoleFetch, useK8sWatchResource, type K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

// MUO's HTTP service creates the CR using the operator's service account,
// bypassing the sre-regular-user-validation admission webhook.
const PREFLIGHT_API = '/api/proxy/plugin/managed-upgrade-operator/muo-api/api/v1/preflight-checks';

interface ClusterVersion extends K8sResourceCommon {
  spec?: { channel?: string };
  status?: {
    desired?: { version?: string };
    history?: Array<{ version: string; state: string }>;
    availableUpdates?: Array<{ version: string }>;
    conditionalUpdates?: Array<{ release: { version: string }; risks?: Array<{ name: string }> }>;
  };
}

export interface InitialValues {
  version: string;
  channel: string;
  platform: 'OSD' | 'ARO';
  description: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  initialValues?: InitialValues;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CHANNEL_RE = /^(stable|fast|candidate|eus)-\d+\.\d+$/;

export const CreatePreflightForm: React.FC<Props> = ({ isOpen, onClose, onCreated, initialValues }) => {
  const [version, setVersion]               = React.useState('');
  const [channel, setChannel]               = React.useState('');
  const [platform, setPlatform]             = React.useState<'OSD' | 'ARO'>('OSD');
  const [description, setDescription]       = React.useState('');
  const [useCustomVersion, setUseCustomVersion] = React.useState(false);
  const [useCustomChannel, setUseCustomChannel] = React.useState(false);
  const [error, setError]                   = React.useState<string | null>(null);
  const [submitting, setSubmitting]         = React.useState(false);

  const [cv, cvLoaded, cvError] = useK8sWatchResource<ClusterVersion>({
    groupVersionKind: { group: 'config.openshift.io', version: 'v1', kind: 'ClusterVersion' },
    name: 'version',
  });

  const currentVersion = cv?.status?.desired?.version
    ?? cv?.status?.history?.find(h => h.state === 'Completed')?.version
    ?? '';
  const currentChannel      = cv?.spec?.channel ?? '';
  const availableUpdates    = cv?.status?.availableUpdates ?? [];
  const conditionalUpdates  = cv?.status?.conditionalUpdates ?? [];

  const channelMatch = currentChannel.match(/^(stable|fast|candidate|eus)-(\d+\.\d+)$/);
  const channelXY    = channelMatch?.[2] ?? '';

  React.useEffect(() => {
    if (!isOpen) return;
    if (initialValues) {
      setVersion(initialValues.version);
      setChannel(initialValues.channel);
      setPlatform(initialValues.platform);
      setDescription(initialValues.description);
      setUseCustomVersion(true);
      setUseCustomChannel(true);
    } else if (currentChannel && !channel) {
      setChannel(currentChannel);
    }
  }, [isOpen, initialValues]);

  const versionError = version && !SEMVER_RE.test(version) ? 'Version must be in X.Y.Z format (e.g. 4.22.22)' : '';
  const channelError = channel && !CHANNEL_RE.test(channel) ? 'Channel must be in {type}-X.Y format (e.g. stable-4.22)' : '';
  const canSubmit    = version && channel && !versionError && !channelError && !submitting;

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
      await consoleFetch(PREFLIGHT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVersion: version,
          targetChannel: channel,
          platform,
          ...(description ? { description } : {}),
        }),
      });
      resetForm();
      onClose();
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create preflight check');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Inline panel — avoids PF Modal's React portal which breaks inside the
  // OpenShift console's plugin iframe (renders outside the visible window).
  return (
    <div style={{
      marginTop: 16,
      padding: '20px 24px',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.03)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {initialValues ? 'Re-run Upgrade Preflight Checks' : 'Run Upgrade Preflight Checks'}
          </div>
          {currentVersion && (
            <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              Current cluster version: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{currentVersion}</strong>
            </div>
          )}
        </div>
        <Button variant="plain" aria-label="Close form" onClick={handleClose} style={{ color: 'rgba(255,255,255,0.5)' }}>
          <TimesIcon />
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'rgba(201,25,11,0.12)',
          borderLeft: '3px solid #c9190b',
          borderRadius: 4, color: '#c9190b', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <Form>
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
                    <FormSelectOption value="" label="— Conditional Updates —" isDisabled />
                    {conditionalUpdates.map(u => (
                      <FormSelectOption
                        key={u.release.version}
                        value={u.release.version}
                        label={`${u.release.version}${u.risks?.[0]?.name ? ` — ${u.risks[0].name}` : ''}`}
                      />
                    ))}
                  </>
                )}
                <FormSelectOption value="" label="—" isDisabled />
                <FormSelectOption value="__custom__" label="Custom version…" />
              </FormSelect>
              <FormHelperText>
                <HelperText><HelperTextItem>
                  {availableUpdates.length === 0 && conditionalUpdates.length === 0 && currentVersion
                    ? 'No updates available from CVO — use "Custom version…" to test any target.'
                    : 'Select from cluster\'s available upgrade targets, or enter a custom version.'}
                </HelperTextItem></HelperText>
              </FormHelperText>
            </>
          )}

          {cvLoaded && (cvError || useCustomVersion) && (
            <>
              {cvError && (
                <div style={{ padding: '8px 12px', marginBottom: 8, background: 'rgba(240,171,0,0.1)', borderLeft: '3px solid #c58c00', borderRadius: 4, fontSize: 13, color: '#c58c00' }}>
                  Unable to load available versions — enter manually
                </div>
              )}
              <TextInput
                id="version-custom"
                value={version}
                onChange={(_e, v) => setVersion(v)}
                placeholder="e.g. 4.22.22"
                validated={versionError ? 'error' : 'default'}
                isRequired
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={versionError ? 'error' : 'default'}>
                    {versionError || (
                      useCustomVersion
                        ? <Button variant="link" isInline onClick={() => { setUseCustomVersion(false); setVersion(''); }}>← Back to version list</Button>
                        : 'Enter the target version in X.Y.Z format'
                    )}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
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
                    <FormSelectOption value="" label="— Sibling Channels —" isDisabled />
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
                  <HelperTextItem variant={channelError ? 'error' : 'default'}>
                    {channelError || 'stable (production), fast (early access), candidate (pre-release)'}
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
                    {channelError || (
                      <Button variant="link" isInline onClick={() => { setUseCustomChannel(false); setChannel(currentChannel); }}>← Back to channel list</Button>
                    )}
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

      {/* Actions */}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button variant="primary" isLoading={submitting} isDisabled={!canSubmit} onClick={handleSubmit}>
          Run Checks
        </Button>
        <Button variant="link" onClick={handleClose} isDisabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
