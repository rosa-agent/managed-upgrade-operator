export type CheckResult = 'Passed' | 'Warning' | 'Failed' | 'Error' | 'Skipped' | 'TimedOut' | 'Unknown';
export type CheckOwner = 'customer' | 'service-team';
export type CheckExecutionState = 'Completed' | 'Error' | 'Skipped' | 'TimedOut';

export interface CheckExecution {
  state: CheckExecutionState;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  findings?: string[];
  error?: string;
}

export interface PreflightCheckResult {
  name: string;
  description?: string;
  result: CheckResult;
  owner?: CheckOwner;
  action?: string;
  timeoutSeconds: number;
  execution: CheckExecution;
}

export interface K8sCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface UpgradePreflightCheckStatus {
  startedAt?: string;
  completedAt?: string;
  overallResult?: CheckResult;
  checksPassed?: number;
  checksWarned?: number;
  checksFailed?: number;
  checksErrored?: number;
  conditions?: K8sCondition[];
  checks?: PreflightCheckResult[];
}

export interface UpgradePreflightCheck {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
  };
  spec: {
    desired: { version: string; channel: string };
    type: 'OSD' | 'ARO';
    checks?: string[];
  };
  status?: UpgradePreflightCheckStatus;
}
