package readiness

// registeredChecks is the ordered list of readiness checks that run against the cluster.
//
// To add a new check:
//  1. Implement ReadinessCheck in the appropriate check_<group>.go file.
//  2. Append it here — that's all.
//
// The framework (runCheck) handles timeout, panic recovery, timing, Description,
// and Owner injection automatically.
var registeredChecks = []ReadinessCheck{
	&clusterVersionCheck{},
	&upgradeTargetCheck{},
	&upgradeTargetExtendedCheck{},
	&upgradeInFlightCheck{},
	&clusterOperatorsCheck{},
	&clusterOperatorsExtendedCheck{},
	&criticalAlertsCheck{},
	&criticalAlertsExtendedCheck{},
	&podDisruptionBudgetsCheck{},
	&pdbMasterInfraExtendedCheck{},
	&manuallyCordonedNodesCheck{},
	&manuallyCordonedNodesExtendedCheck{},
	&nodeTaintsCheck{},
	&nodeTaintsExtendedCheck{},
	&upgradeableConditionCheck{},
	&pullSecretCheck{},
	&adminAcksCheck{},
}
