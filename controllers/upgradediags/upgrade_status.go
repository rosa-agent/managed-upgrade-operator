package upgradediags

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	configv1 "github.com/openshift/api/config/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// ---- Response types --------------------------------------------------------

// UpgradeStatusSnapshot is the top-level response for GET /api/v1/upgrade-status.
// It is a live read — no CR is created; every field reflects cluster state at
// the moment the request is received.
type UpgradeStatusSnapshot struct {
	// Phase is the high-level upgrade lifecycle phase.
	// One of: not-started, pre-checks, control-plane, operators,
	//         worker-upgrade, complete, stalled, failed, unknown.
	Phase          string `json:"phase"`
	TargetVersion  string `json:"targetVersion,omitempty"`
	CurrentVersion string `json:"currentVersion,omitempty"`
	// CVOMessage is the human-readable message from the CVO Progressing condition.
	CVOMessage     string              `json:"cvoMessage,omitempty"`
	StartedAt      *metav1.Time        `json:"startedAt,omitempty"`
	ElapsedSeconds int64               `json:"elapsedSeconds,omitempty"`
	ControlPlane   ControlPlaneStatus  `json:"controlPlane"`
	Operators      OperatorsStatus     `json:"clusterOperators"`
	MachinePools   []MachinePoolStatus `json:"machinePools"`
	// Blockers lists conditions actively preventing upgrade progress.
	// Empty when the upgrade is proceeding normally or is not started.
	Blockers []UpgradeBlocker `json:"blockers,omitempty"`
}

type ControlPlaneStatus struct {
	// Phase: not-started, upgrading, complete, failed.
	Phase          string       `json:"phase"`
	StartedAt      *metav1.Time `json:"startedAt,omitempty"`
	CompletedAt    *metav1.Time `json:"completedAt,omitempty"`
	ElapsedSeconds int64        `json:"elapsedSeconds,omitempty"`
	Message        string       `json:"message,omitempty"`
}

type OperatorsStatus struct {
	// Phase: not-started, progressing, complete, degraded.
	Phase          string           `json:"phase"`
	Total          int              `json:"total"`
	Available      int              `json:"available"`
	Progressing    int              `json:"progressing"`
	Degraded       int              `json:"degraded"`
	StartedAt      *metav1.Time     `json:"startedAt,omitempty"`
	CompletedAt    *metav1.Time     `json:"completedAt,omitempty"`
	ElapsedSeconds int64            `json:"elapsedSeconds,omitempty"`
	Operators      []OperatorStatus `json:"operators"`
}

type OperatorStatus struct {
	Name        string `json:"name"`
	// Phase: available, progressing, degraded.
	Phase       string `json:"phase"`
	Version     string `json:"version,omitempty"`
	Available   bool   `json:"available"`
	Progressing bool   `json:"progressing"`
	Degraded    bool   `json:"degraded"`
	// Message is the most relevant condition message (Progressing or Degraded).
	Message               string       `json:"message,omitempty"`
	ProgressingSince      *metav1.Time `json:"progressingSince,omitempty"`
	ElapsedInPhaseSeconds int64        `json:"elapsedInPhaseSeconds,omitempty"`
}

type MachinePoolStatus struct {
	Name string `json:"name"`
	// Phase: not-started, updating, updated, degraded.
	Phase          string       `json:"phase"`
	Total          int          `json:"total"`
	Updated        int          `json:"updated"`
	Ready          int          `json:"ready"`
	Unavailable    int          `json:"unavailable"`
	Degraded       int          `json:"degraded"`
	StartedAt      *metav1.Time `json:"startedAt,omitempty"`
	CompletedAt    *metav1.Time `json:"completedAt,omitempty"`
	ElapsedSeconds int64        `json:"elapsedSeconds,omitempty"`
	Nodes          []NodeStatus `json:"nodes,omitempty"`
}

type NodeStatus struct {
	Name string `json:"name"`
	// Phase: done, working, rebooting, degraded, draining, unknown.
	Phase         string       `json:"phase"`
	CurrentConfig string       `json:"currentConfig,omitempty"`
	DesiredConfig string       `json:"desiredConfig,omitempty"`
	// PhaseSince is when the node entered its current phase (from MachineConfig state annotation change).
	PhaseSince     *metav1.Time `json:"phaseSince,omitempty"`
	ElapsedSeconds int64        `json:"elapsedSeconds,omitempty"`
}

type UpgradeBlocker struct {
	// Type is a machine-readable blocker category:
	//   operator-degraded, operator-progressing-stalled,
	//   node-stalled, mcp-degraded, cvo-degraded.
	Type           string       `json:"type"`
	Component      string       `json:"component"`
	Message        string       `json:"message"`
	Since          *metav1.Time `json:"since,omitempty"`
	ElapsedSeconds int64        `json:"elapsedSeconds,omitempty"`
}

// UpgradeHistoryEntry is one entry from ClusterVersion's upgrade history.
type UpgradeHistoryEntry struct {
	Version     string       `json:"version"`
	State       string       `json:"state"`
	StartedAt   *metav1.Time `json:"startedAt,omitempty"`
	CompletedAt *metav1.Time `json:"completedAt,omitempty"`
	Message     string       `json:"message,omitempty"`
}

// ---- HTTP routing ----------------------------------------------------------

func (s *UpgradeDiagsHTTPServer) routeStatus(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if p := recover(); p != nil {
			s.Logger.Error(fmt.Errorf("%v", p), "panic in upgrade status handler")
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}()
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := extractBearerToken(r)
	if token == "" {
		http.Error(w, "Authorization: Bearer <token> required", http.StatusUnauthorized)
		return
	}
	if err := s.authorizeToken(r.Context(), token, "get"); err != nil {
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}
	path := strings.TrimSuffix(r.URL.Path, "/")
	if strings.HasSuffix(path, "/history") {
		s.handleStatusHistory(w, r)
	} else {
		s.handleStatus(w, r)
	}
}

func (s *UpgradeDiagsHTTPServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	snap, err := s.buildStatusSnapshot(r.Context())
	if err != nil {
		s.Logger.Error(err, "Failed to build upgrade status snapshot")
		http.Error(w, "Internal error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *UpgradeDiagsHTTPServer) handleStatusHistory(w http.ResponseWriter, r *http.Request) {
	cv := &configv1.ClusterVersion{}
	if err := s.Client.Get(r.Context(), types.NamespacedName{Name: "version"}, cv); err != nil {
		http.Error(w, "Failed to read ClusterVersion: "+err.Error(), http.StatusInternalServerError)
		return
	}
	entries := make([]UpgradeHistoryEntry, 0, len(cv.Status.History))
	for _, h := range cv.Status.History {
		e := UpgradeHistoryEntry{
			Version: h.Version,
			State:   string(h.State),
			Message: h.AcceptedRisks,
		}
		if !h.StartedTime.IsZero() {
			t := metav1.NewTime(h.StartedTime.Time)
			e.StartedAt = &t
		}
		if h.CompletionTime != nil && !h.CompletionTime.IsZero() {
			t := metav1.NewTime(h.CompletionTime.Time)
			e.CompletedAt = &t
		}
		entries = append(entries, e)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"history": entries,
		"total":   len(entries),
	})
}

// ---- Snapshot builder ------------------------------------------------------

func (s *UpgradeDiagsHTTPServer) buildStatusSnapshot(ctx context.Context) (*UpgradeStatusSnapshot, error) {
	now := time.Now()

	cv := &configv1.ClusterVersion{}
	if err := s.Client.Get(ctx, types.NamespacedName{Name: "version"}, cv); err != nil {
		return nil, fmt.Errorf("reading ClusterVersion: %w", err)
	}

	// ClusterOperators — errors are soft: we return partial data.
	coList := &configv1.ClusterOperatorList{}
	_ = s.Client.List(ctx, coList)

	// MachineConfigPools via unstructured — optional; skip on error.
	mcps, _ := s.listMCPs(ctx)

	// Nodes for per-node detail — optional.
	nodeList := &corev1.NodeList{}
	_ = s.Client.List(ctx, nodeList)

	snap := &UpgradeStatusSnapshot{}
	snap.CurrentVersion = currentVersion(cv)
	snap.TargetVersion = targetVersion(cv)

	// Upgrade start time: find the history entry for the target version.
	if snap.TargetVersion != "" {
		for _, h := range cv.Status.History {
			if h.Version == snap.TargetVersion {
				t := metav1.NewTime(h.StartedTime.Time)
				snap.StartedAt = &t
				break
			}
		}
	}
	if snap.StartedAt != nil && !snap.StartedAt.IsZero() {
		snap.ElapsedSeconds = int64(now.Sub(snap.StartedAt.Time).Seconds())
	}

	// CVOMessage from Progressing condition.
	for _, c := range cv.Status.Conditions {
		if c.Type == configv1.OperatorProgressing && c.Status == configv1.ConditionTrue {
			snap.CVOMessage = c.Message
			break
		}
	}

	// Build sub-statuses.
	snap.ControlPlane = buildControlPlaneStatus(cv, now)
	snap.Operators = buildOperatorsStatus(coList, now)
	snap.MachinePools = buildMachinePoolStatuses(mcps, nodeList, now)

	// Determine top-level phase.
	snap.Phase = detectUpgradePhase(cv, snap.ControlPlane, snap.Operators, snap.MachinePools)

	// Collect blockers.
	snap.Blockers = collectBlockers(cv, snap.Operators, snap.MachinePools, now)

	return snap, nil
}

// ---- ClusterVersion helpers ------------------------------------------------

func currentVersion(cv *configv1.ClusterVersion) string {
	for _, h := range cv.Status.History {
		if h.State == configv1.CompletedUpdate {
			return h.Version
		}
	}
	return cv.Status.Desired.Version
}

func targetVersion(cv *configv1.ClusterVersion) string {
	if cv.Spec.DesiredUpdate != nil && cv.Spec.DesiredUpdate.Version != "" {
		return cv.Spec.DesiredUpdate.Version
	}
	return ""
}

func cvoCondition(cv *configv1.ClusterVersion, t configv1.ClusterStatusConditionType) (status bool, msg string, since metav1.Time) {
	for _, c := range cv.Status.Conditions {
		if c.Type == t {
			return c.Status == configv1.ConditionTrue, c.Message, c.LastTransitionTime
		}
	}
	return false, "", metav1.Time{}
}

// ---- Control plane status --------------------------------------------------

func buildControlPlaneStatus(cv *configv1.ClusterVersion, now time.Time) ControlPlaneStatus {
	progressing, progressMsg, progressSince := cvoCondition(cv, configv1.OperatorProgressing)
	degraded, degradeMsg, _ := cvoCondition(cv, configv1.OperatorDegraded)
	available, _, _ := cvoCondition(cv, configv1.OperatorAvailable)

	target := targetVersion(cv)
	current := currentVersion(cv)

	var cp ControlPlaneStatus

	switch {
	case degraded && !progressing:
		cp.Phase = "failed"
		cp.Message = degradeMsg
	case progressing:
		cp.Phase = "upgrading"
		cp.Message = progressMsg
		if !progressSince.IsZero() {
			cp.StartedAt = &progressSince
			cp.ElapsedSeconds = int64(now.Sub(progressSince.Time).Seconds())
		}
	case available && target != "" && target == current:
		cp.Phase = "complete"
		// Find completion time from history.
		for _, h := range cv.Status.History {
			if h.Version == target && h.State == configv1.CompletedUpdate {
				if !h.StartedTime.IsZero() {
					t := metav1.NewTime(h.StartedTime.Time)
					cp.StartedAt = &t
				}
				if h.CompletionTime != nil && !h.CompletionTime.IsZero() {
					cp.CompletedAt = h.CompletionTime
					if cp.StartedAt != nil {
						cp.ElapsedSeconds = int64(cp.CompletedAt.Time.Sub(cp.StartedAt.Time).Seconds())
					}
				}
				break
			}
		}
	default:
		cp.Phase = "not-started"
	}

	return cp
}

// ---- ClusterOperator status ------------------------------------------------

func buildOperatorsStatus(coList *configv1.ClusterOperatorList, now time.Time) OperatorsStatus {
	os := OperatorsStatus{
		Total:     len(coList.Items),
		Operators: make([]OperatorStatus, 0, len(coList.Items)),
	}

	var earliestProgressing, latestProgressing metav1.Time

	for _, co := range coList.Items {
		op := OperatorStatus{Name: co.Name}

		for _, c := range co.Status.Conditions {
			switch c.Type {
			case configv1.OperatorAvailable:
				op.Available = c.Status == configv1.ConditionTrue
			case configv1.OperatorProgressing:
				op.Progressing = c.Status == configv1.ConditionTrue
				if op.Progressing {
					op.Message = c.Message
					op.ProgressingSince = &c.LastTransitionTime
					op.ElapsedInPhaseSeconds = int64(now.Sub(c.LastTransitionTime.Time).Seconds())
					if earliestProgressing.IsZero() || c.LastTransitionTime.Before(&earliestProgressing) {
						earliestProgressing = c.LastTransitionTime
					}
					if c.LastTransitionTime.After(latestProgressing.Time) {
						latestProgressing = c.LastTransitionTime
					}
				}
			case configv1.OperatorDegraded:
				op.Degraded = c.Status == configv1.ConditionTrue
				if op.Degraded && op.Message == "" {
					op.Message = c.Message
				}
			}
		}

		// Operator version: take the first entry from Status.Versions.
		if len(co.Status.Versions) > 0 {
			op.Version = co.Status.Versions[0].Version
		}

		switch {
		case op.Degraded:
			op.Phase = "degraded"
			os.Degraded++
		case op.Progressing:
			op.Phase = "progressing"
			os.Progressing++
		case op.Available:
			op.Phase = "available"
			os.Available++
		default:
			op.Phase = "unknown"
		}

		os.Operators = append(os.Operators, op)
	}

	switch {
	case os.Degraded > 0:
		os.Phase = "degraded"
	case os.Progressing > 0:
		os.Phase = "progressing"
		if !earliestProgressing.IsZero() {
			os.StartedAt = &earliestProgressing
			os.ElapsedSeconds = int64(now.Sub(earliestProgressing.Time).Seconds())
		}
	case os.Total > 0 && os.Available == os.Total:
		os.Phase = "complete"
	default:
		os.Phase = "not-started"
	}

	return os
}

// ---- MachineConfigPool status ----------------------------------------------

var mcpGVK = schema.GroupVersionKind{
	Group:   "machineconfiguration.openshift.io",
	Version: "v1",
	Kind:    "MachineConfigPoolList",
}

func (s *UpgradeDiagsHTTPServer) listMCPs(ctx context.Context) ([]unstructured.Unstructured, error) {
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(mcpGVK)
	if err := s.Client.List(ctx, list); err != nil {
		return nil, err
	}
	return list.Items, nil
}

func buildMachinePoolStatuses(mcps []unstructured.Unstructured, nodeList *corev1.NodeList, now time.Time) []MachinePoolStatus {
	// Index nodes by pool membership (role labels).
	nodesByPool := make(map[string][]corev1.Node)
	for _, node := range nodeList.Items {
		for label := range node.Labels {
			if strings.HasPrefix(label, "node-role.kubernetes.io/") {
				role := strings.TrimPrefix(label, "node-role.kubernetes.io/")
				nodesByPool[role] = append(nodesByPool[role], node)
			}
		}
	}

	pools := make([]MachinePoolStatus, 0, len(mcps))
	for _, mcp := range mcps {
		name, _, _ := unstructured.NestedString(mcp.Object, "metadata", "name")
		status, _, _ := unstructured.NestedMap(mcp.Object, "status")

		ps := MachinePoolStatus{Name: name}
		ps.Total = intField(status, "machineCount")
		ps.Updated = intField(status, "updatedMachineCount")
		ps.Ready = intField(status, "readyMachineCount")
		ps.Unavailable = intField(status, "unavailableMachineCount")
		ps.Degraded = intField(status, "degradedMachineCount")

		// Timestamps from MCP conditions.
		if conds, ok := status["conditions"].([]interface{}); ok {
			for _, ci := range conds {
				c, ok := ci.(map[string]interface{})
				if !ok {
					continue
				}
				ctype, _ := c["type"].(string)
				cstatus, _ := c["status"].(string)
				transitionTime, _ := c["lastTransitionTime"].(string)
				t, _ := time.Parse(time.RFC3339, transitionTime)
				mt := metav1.NewTime(t)

				switch ctype {
				case "Updating":
					if cstatus == "True" && !t.IsZero() {
						ps.StartedAt = &mt
						ps.ElapsedSeconds = int64(now.Sub(t).Seconds())
					}
				case "Updated":
					if cstatus == "True" && !t.IsZero() {
						ps.CompletedAt = &mt
						if ps.StartedAt != nil {
							ps.ElapsedSeconds = int64(ps.CompletedAt.Time.Sub(ps.StartedAt.Time).Seconds())
						}
					}
				}
			}
		}

		switch {
		case ps.Degraded > 0:
			ps.Phase = "degraded"
		case ps.Updated == ps.Total && ps.Total > 0:
			ps.Phase = "updated"
		case ps.Unavailable > 0 || (ps.Updated < ps.Total && ps.Total > 0):
			ps.Phase = "updating"
		default:
			ps.Phase = "not-started"
		}

		// Per-node details from the node list for this pool's role.
		for _, node := range nodesByPool[name] {
			ps.Nodes = append(ps.Nodes, buildNodeStatus(node, now))
		}

		pools = append(pools, ps)
	}
	return pools
}

func buildNodeStatus(node corev1.Node, now time.Time) NodeStatus {
	ann := node.Annotations
	if ann == nil {
		ann = map[string]string{}
	}
	ns := NodeStatus{
		Name:          node.Name,
		CurrentConfig: ann["machineconfiguration.openshift.io/currentConfig"],
		DesiredConfig: ann["machineconfiguration.openshift.io/desiredConfig"],
	}

	mcState := strings.ToLower(ann["machineconfiguration.openshift.io/state"])
	switch mcState {
	case "done":
		ns.Phase = "done"
	case "working":
		ns.Phase = "working"
	case "rebooting":
		ns.Phase = "rebooting"
	case "degraded":
		ns.Phase = "degraded"
	default:
		if node.Spec.Unschedulable {
			ns.Phase = "draining"
		} else {
			ns.Phase = "unknown"
		}
	}

	// Use node condition LastTransitionTime as a proxy for when phase started.
	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			ns.PhaseSince = &cond.LastTransitionTime
			ns.ElapsedSeconds = int64(now.Sub(cond.LastTransitionTime.Time).Seconds())
			break
		}
	}

	return ns
}

// ---- Phase detection -------------------------------------------------------

func detectUpgradePhase(cv *configv1.ClusterVersion, cp ControlPlaneStatus, ops OperatorsStatus, pools []MachinePoolStatus) string {
	target := targetVersion(cv)
	current := currentVersion(cv)

	if target == "" {
		return "not-started"
	}

	progressing, _, _ := cvoCondition(cv, configv1.OperatorProgressing)
	degraded, _, _ := cvoCondition(cv, configv1.OperatorDegraded)

	// Upgrade complete: CVO says not progressing, available, and at target.
	if !progressing && !degraded && target == current {
		return "complete"
	}

	if degraded && !progressing {
		return "failed"
	}

	if !progressing && target != current {
		return "pre-checks"
	}

	// Progressing: determine which phase by what's still pending.
	masterDone := true
	workerDone := true
	for _, p := range pools {
		if p.Name == "master" && p.Phase != "updated" {
			masterDone = false
		}
		if p.Name != "master" && p.Phase != "updated" {
			workerDone = false
		}
	}

	switch {
	case !masterDone:
		return "control-plane"
	case ops.Phase == "progressing" || ops.Phase == "degraded":
		return "operators"
	case !workerDone:
		return "worker-upgrade"
	default:
		return "operators" // CVO is progressing but we can't tell more precisely
	}
}

// ---- Blocker detection -----------------------------------------------------

const (
	operatorStalledThreshold = 10 * time.Minute
	nodeStalledThreshold     = 30 * time.Minute
)

func collectBlockers(cv *configv1.ClusterVersion, ops OperatorsStatus, pools []MachinePoolStatus, now time.Time) []UpgradeBlocker {
	var blockers []UpgradeBlocker

	// CVO degraded.
	if degraded, msg, since := cvoCondition(cv, configv1.OperatorDegraded); degraded {
		elapsed := int64(now.Sub(since.Time).Seconds())
		blockers = append(blockers, UpgradeBlocker{
			Type:           "cvo-degraded",
			Component:      "cluster-version-operator",
			Message:        msg,
			Since:          &since,
			ElapsedSeconds: elapsed,
		})
	}

	// Degraded or long-stalled operators.
	for _, op := range ops.Operators {
		if op.Degraded {
			var since *metav1.Time
			var elapsed int64
			if op.ProgressingSince != nil {
				since = op.ProgressingSince
				elapsed = int64(now.Sub(op.ProgressingSince.Time).Seconds())
			}
			blockers = append(blockers, UpgradeBlocker{
				Type:           "operator-degraded",
				Component:      op.Name,
				Message:        op.Message,
				Since:          since,
				ElapsedSeconds: elapsed,
			})
		} else if op.Progressing && op.ProgressingSince != nil &&
			now.Sub(op.ProgressingSince.Time) > operatorStalledThreshold {
			elapsed := int64(now.Sub(op.ProgressingSince.Time).Seconds())
			blockers = append(blockers, UpgradeBlocker{
				Type:           "operator-progressing-stalled",
				Component:      op.Name,
				Message:        fmt.Sprintf("Progressing for %dm: %s", elapsed/60, op.Message),
				Since:          op.ProgressingSince,
				ElapsedSeconds: elapsed,
			})
		}
	}

	// Degraded MCPs or stalled nodes.
	for _, pool := range pools {
		if pool.Degraded > 0 {
			blockers = append(blockers, UpgradeBlocker{
				Type:      "mcp-degraded",
				Component: pool.Name,
				Message:   fmt.Sprintf("%d/%d machines degraded in pool %q", pool.Degraded, pool.Total, pool.Name),
				Since:     pool.StartedAt,
			})
		}
		for _, node := range pool.Nodes {
			if node.Phase == "working" && node.PhaseSince != nil &&
				now.Sub(node.PhaseSince.Time) > nodeStalledThreshold {
				elapsed := int64(now.Sub(node.PhaseSince.Time).Seconds())
				blockers = append(blockers, UpgradeBlocker{
					Type:           "node-stalled",
					Component:      node.Name,
					Message:        fmt.Sprintf("Node has been in %q phase for %dm", node.Phase, elapsed/60),
					Since:          node.PhaseSince,
					ElapsedSeconds: elapsed,
				})
			}
		}
	}

	return blockers
}

// ---- Utilities -------------------------------------------------------------

func intField(m map[string]interface{}, key string) int {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int64:
		return int(n)
	case float64:
		return int(n)
	case int:
		return n
	}
	return 0
}
