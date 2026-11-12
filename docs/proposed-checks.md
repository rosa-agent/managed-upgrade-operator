# Proposed New Upgrade Diagnostics Checks

Source: Six-month OHSS incident review (MCS-48/MCS-140, 117 cards, Apr–Sep 2026)
and the ROSA Classic / OSD upgrade technical reference.

Each entry maps to one or more OHSS cases that justify it. All checks are
read-only, non-intrusive, and run inside the cluster via the `upgradediags`
controller using `deps.Client` (controller-runtime). No external API calls.

---

## Implementation status

| Check name | File | Status |
|---|---|---|
| `PausedMachineConfigPool` | `check_mcps.go` | ✅ done |
| `WorkerNodeReadiness` | `check_nodes.go` | ✅ done |
| `StuckTerminatingPods` | `check_pods.go` | ✅ done |
| `PendingCSRs` | `check_csr.go` | ✅ done |
| `InstalledOperatorMaxVersion` | `check_operators.go` | ✅ done |
| `ConsolePluginReferences` | `check_consoleplugins.go` | ✅ done |
| `ClusterAutoscalerConfig` | `check_autoscaler.go` | ✅ done |

Deferred (require cloud API access or complex version parsing beyond cluster scope):
- `SurgeWorkerCapacity` — AWS vCPU quota; needs cloud-provider API
- `CgroupModeCompatibility` — target-version cgroup requirement; needs release image metadata
- `RegistryConnectivity` — requires running a pod or exec; too invasive for a read-only check
- `ProxyConsistency` — low incident count; defer

---

## Check descriptions

### PausedMachineConfigPool
**OHSS case:** Case 3 — Worker rollout stalls (OHSS-58658: customer-paused MCP)
**What:** Lists MachineConfigPools with `spec.paused: true`. A paused pool will not
roll worker nodes during an upgrade — MUO step 12 (AllWorkersUpgraded) will wait
indefinitely until the pool is unpaused.
**Owner:** Customer — the admin set `spec.paused`.
**Action:** `oc patch mcp <name> --type merge -p '{"spec":{"paused":false}}'`

### WorkerNodeReadiness
**OHSS case:** Case 10 — EOL/unready workers (OHSS-56336, OHSS-56668)
**What:** Lists worker nodes not in Ready state or SchedulingDisabled (excluding
nodes already in an MUO-managed cordon). Zero-ready workers with ClusterOperators
that require compute will block control-plane upgrade convergence.
**Owner:** Customer / ServiceTeam depending on cause.
**Action:** Investigate NotReady nodes; check `oc describe node <name>` for conditions.

### StuckTerminatingPods
**OHSS case:** Case 7 — Drain stalls (OHSS-54902: stuck pods preventing node drain)
**What:** Finds pods stuck in `Terminating` for longer than 5 minutes across all
namespaces. These pods block node drain during both the extra worker scale-down
(step 13) and the main worker rollout.
**Owner:** Customer (workload namespace) or ServiceTeam (openshift-* namespace).
**Action:** `oc delete pod <name> -n <ns> --grace-period=0 --force` after verifying
the workload is safe to force-delete.

### PendingCSRs
**OHSS case:** Case 3 — Worker stalls (OHSS-57583: CSR approval failure after CA rotation)
**What:** Lists CertificateSigningRequests in `Pending` state. Pending CSRs block
new replacement worker nodes from joining the cluster after machine replacement.
MUO does not auto-approve CSRs.
**Owner:** ServiceTeam — CSR approval is a Red Hat responsibility on managed clusters.
**Action:** Contact Red Hat support; do not approve CSRs manually without verification.

### InstalledOperatorMaxVersion
**OHSS case:** Case 5 — Configuration incompatibility (OHSS-53041: logging operator
blocking 4.19 upgrade due to maxOpenShiftVersion annotation)
**What:** Scans all ClusterServiceVersions (OLM-managed operators) for the
`olm.maxOpenShiftVersion` annotation. Flags any operator whose declared maximum
supported OCP version is less than the target upgrade version.
**Owner:** Customer — operator must be updated or removed before the upgrade.
**Action:** Update or remove the flagged operator before upgrading.

### ConsolePluginReferences
**OHSS case:** Case 5 — Configuration incompatibility (OHSS-55964: invalid console
plugin references contributing to eviction and console instability)
**What:** Lists ConsolePlugin CRs and verifies that each referenced Service exists
in the specified namespace. Orphaned plugin references cause the console operator
to report degraded and can cause pod eviction pressure.
**Owner:** Customer — the plugin was installed by the cluster admin.
**Action:** Remove or repair orphaned ConsolePlugin CRs before upgrading.

### ClusterAutoscalerConfig
**OHSS case:** Case 5 — Configuration incompatibility (OHSS-56299: invalid
ClusterAutoscaler utilization threshold delaying a 4.19 update)
**What:** Reads the `cluster` ClusterAutoscaler object and validates that
`spec.resourceLimits.maxNodesTotal > 0` (when set), and that
`spec.scaleDown.utilizationThreshold` (when set) is a valid float string in
(0.0, 1.0]. An invalid threshold causes the autoscaler operator to degrade,
which then blocks the upgrade gate.
**Owner:** Customer — ClusterAutoscaler is customer-configurable.
**Action:** Fix the invalid field value and wait for the autoscaler operator to
recover before rescheduling the upgrade.
