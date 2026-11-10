import * as React from 'react';
import {
  ExpandableSection, List, ListItem, Alert,
  DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
} from '@patternfly/react-core';
import { type PreflightCheckResult } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props { checks: PreflightCheckResult[]; }

export const PreflightCheckDetail: React.FC<Props> = ({ checks }) => (
  <DescriptionList isHorizontal>
    {checks.map((c) => (
      <DescriptionListGroup key={c.name}>
        <DescriptionListTerm>{c.name}</DescriptionListTerm>
        <DescriptionListDescription>
          <StatusBadge result={c.result} />
          {c.execution.summary && <p style={{ marginTop: 4 }}>{c.execution.summary}</p>}
          {c.action && (
            <Alert variant="warning" isInline title="Recommended action" style={{ marginTop: 8 }}>
              {c.action}
            </Alert>
          )}
          {c.execution.findings && c.execution.findings.length > 0 && (
            <ExpandableSection toggleText="Findings" style={{ marginTop: 4 }}>
              <List>
                {c.execution.findings.map((f, i) => <ListItem key={i}>{f}</ListItem>)}
              </List>
            </ExpandableSection>
          )}
          {c.execution.error && (
            <Alert variant="danger" isInline title="Check error" style={{ marginTop: 8 }}>
              {c.execution.error}
            </Alert>
          )}
        </DescriptionListDescription>
      </DescriptionListGroup>
    ))}
  </DescriptionList>
);
