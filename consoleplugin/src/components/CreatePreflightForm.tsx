import * as React from 'react';
import {
  Modal, ModalVariant, Button, Form, FormGroup,
  TextInput, FormSelect, FormSelectOption, ActionGroup,
  Alert,
} from '@patternfly/react-core';
import { consoleFetch } from '@openshift-console/dynamic-plugin-sdk';

const PROXY_BASE = '/api/proxy/plugin/managed-upgrade-operator/preflight-api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

export const CreatePreflightForm: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [version, setVersion] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [platform, setPlatform] = React.useState<'OSD' | 'ARO'>('OSD');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await consoleFetch(`${PROXY_BASE}/api/v1/preflight-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVersion: version, targetChannel: channel, platform }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        setError(`${resp.status}: ${text}`);
        return;
      }
      const data = await resp.json();
      onCreated(data.requestId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      variant={ModalVariant.small}
      title="Run Upgrade Preflight Checks"
      isOpen={isOpen}
      onClose={onClose}
    >
      <Form>
        {error && <Alert variant="danger" isInline title="Error">{error}</Alert>}
        <FormGroup label="Target Version" isRequired fieldId="version">
          <TextInput id="version" value={version} onChange={(_, v) => setVersion(v)} placeholder="e.g. 4.17.3" />
        </FormGroup>
        <FormGroup label="Channel" isRequired fieldId="channel">
          <TextInput id="channel" value={channel} onChange={(_, v) => setChannel(v)} placeholder="e.g. stable-4.17" />
        </FormGroup>
        <FormGroup label="Platform" isRequired fieldId="platform">
          <FormSelect id="platform" value={platform} onChange={(_, v) => setPlatform(v as 'OSD' | 'ARO')}>
            <FormSelectOption value="OSD" label="OSD" />
            <FormSelectOption value="ARO" label="ARO" />
          </FormSelect>
        </FormGroup>
        <ActionGroup>
          <Button variant="primary" isLoading={submitting} isDisabled={!version || !channel || submitting} onClick={handleSubmit}>
            Run Checks
          </Button>
          <Button variant="link" onClick={onClose}>Cancel</Button>
        </ActionGroup>
      </Form>
    </Modal>
  );
};
