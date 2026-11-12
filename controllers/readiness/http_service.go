package readiness

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-logr/logr"
	"github.com/google/uuid"
	upgradev1alpha1 "github.com/openshift/managed-upgrade-operator/api/v1alpha1"
	authnv1 "k8s.io/api/authentication/v1"
	authzv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	// readinessHTTPPort is the port the HTTP service listens on.
	readinessHTTPPort = ":8443"

	// requestIDLabel is placed on internal UpgradeReadinessCheck CRs so the HTTP
	// service can find them by requestId without an in-memory map.
	requestIDLabel = "readiness.managed.openshift.io/request-id"

	// tlsCertEnv / tlsKeyEnv allow overriding the cert paths (e.g. for local dev).
	tlsCertEnv      = "READINESS_TLS_CERT"
	tlsKeyEnv       = "READINESS_TLS_KEY"
	defaultCertFile = "/etc/readiness-tls/tls.crt"
	defaultKeyFile  = "/etc/readiness-tls/tls.key"
)

// CheckRequest is the body of POST /api/v1/readiness-checks.
type CheckRequest struct {
	TargetVersion       string   `json:"targetVersion"`
	TargetChannel       string   `json:"targetChannel"`
	Platform            string   `json:"platform"`
	DefaultCheckTimeoutSeconds int32    `json:"defaultCheckTimeoutSeconds,omitempty"`
	OverallTimeoutSeconds      int32    `json:"overallTimeoutSeconds,omitempty"`
	ChecksToRun                []string `json:"checksToRun,omitempty"`
	Description         string   `json:"description,omitempty"`
	// NamePrefix sets a custom prefix for the generated UpgradeReadinessCheck CR name.
	// Must be a valid DNS label segment (lowercase alphanumeric and hyphens, no leading/trailing hyphens).
	// Defaults to "upgradediags" if empty or invalid.
	NamePrefix string `json:"namePrefix,omitempty"`
}

// CheckResponse is the body returned by GET /api/v1/readiness-checks/{id}.
type CheckResponse struct {
	RequestID       string        `json:"requestId"`
	Status          string        `json:"status"`
	StartedAt       *metav1.Time  `json:"startedAt,omitempty"`
	CompletedAt     *metav1.Time  `json:"completedAt,omitempty"`
	TargetVersion   string        `json:"targetVersion"`
	TargetChannel   string        `json:"targetChannel"`
	Platform        string        `json:"platform"`
	ChecksTotal     int           `json:"checksTotal"`
	ChecksCompleted int           `json:"checksCompleted"`
	ChecksPassed    int           `json:"checksPassed"`
	ChecksWarned    int           `json:"checksWarned"`
	ChecksFailed    int           `json:"checksFailed"`
	ChecksSkipped   int           `json:"checksSkipped"`
	ChecksErrored   int           `json:"checksErrored"`
	OverallStatus   string        `json:"overallStatus,omitempty"`
	Message         string        `json:"message,omitempty"`
	Results         []CheckResult `json:"results,omitempty"`
}

// CheckResult is a per-check entry within CheckResponse.
type CheckResult struct {
	Name    string   `json:"name"`
	Status  string   `json:"status"`
	Owner   string   `json:"owner,omitempty"`
	Action  string   `json:"action,omitempty"`
	Message string   `json:"message,omitempty"`
	Details []string `json:"details,omitempty"`
}

// PreflightHTTPServer serves the readiness check HTTP API.
// It uses the operator's own service-account client to create internal
// UpgradeReadinessCheck CRs (which the sre-regular-user-validation webhook
// permits for the operator SA), while enforcing the caller's RBAC via
// TokenReview + SubjectAccessReview before acting on their behalf.
type ReadinessHTTPServer struct {
	Client    client.Client
	Namespace string
	Logger    logr.Logger
}

// Start listens on readinessHTTPPort with TLS until ctx is cancelled.
// If TLS certificates are not present the server logs a warning and returns nil
// (non-fatal: the operator continues without HTTP access to readiness checks).
func (s *ReadinessHTTPServer) Start(ctx context.Context) error {
	certFile := envOr(tlsCertEnv, defaultCertFile)
	keyFile := envOr(tlsKeyEnv, defaultKeyFile)

	if _, err := os.Stat(certFile); err != nil {
		s.Logger.Info("Readiness HTTP service: TLS cert not found, HTTP service disabled",
			"cert", certFile, "hint", "annotate the Service with service.beta.openshift.io/serving-cert-secret-name")
		return err
	}

	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("readiness HTTP: loading TLS cert: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/readiness-checks", s.route)
	mux.HandleFunc("/api/v1/readiness-checks/", s.route)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	srv := &http.Server{
		Addr:              readinessHTTPPort,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		},
	}

	//nolint:gosec,contextcheck // shutdown timeout is independent of request context
	go func(stopCtx context.Context) {
		<-stopCtx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}(ctx)

	s.Logger.Info("Starting readiness HTTP service", "addr", readinessHTTPPort)
	if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("readiness HTTP server: %w", err)
	}
	return nil
}

// CatalogEntry describes a single registered readiness check for the catalog endpoint.
type CatalogEntry struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Owner       string `json:"owner"`
	TimeoutSecs int    `json:"timeoutSeconds,omitempty"`
}

// route dispatches based on method and path.
func (s *ReadinessHTTPServer) route(w http.ResponseWriter, r *http.Request) {
	// Catch any panic in a handler so a nil-pointer or unexpected error in this
	// controller cannot crash the net/http goroutine and take down the HTTP service.
	// Go's net/http recovers handler panics too, but logs them to stderr; this gives
	// us structured logging and a proper 500 response.
	defer func() {
		if p := recover(); p != nil {
			s.Logger.Error(fmt.Errorf("%v", p), "panic in readiness HTTP handler; request aborted",
				"method", r.Method, "path", r.URL.Path)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}()

	// /api/v1/readiness-checks/{id} has 5 slash-separated parts after trim
	path := strings.TrimSuffix(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	requestID := ""
	if len(parts) == 5 {
		requestID = parts[4]
	}

	// Catalog endpoint: returns registered check names/descriptions. No auth required.
	if r.Method == http.MethodGet && requestID == "checks" {
		s.handleCatalog(w)
		return
	}

	token := extractBearerToken(r)
	if token == "" {
		http.Error(w, "Authorization: Bearer <token> required", http.StatusUnauthorized)
		return
	}

	switch {
	case r.Method == http.MethodPost && requestID == "":
		s.handleCreate(w, r, token)
	case r.Method == http.MethodGet && requestID != "":
		s.handleGet(w, r, token, requestID)
	case r.Method == http.MethodGet && requestID == "":
		s.handleList(w, r, token)
	case r.Method == http.MethodDelete && requestID != "":
		s.handleDelete(w, r, token, requestID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleCatalog returns the list of registered checks with their names, descriptions,
// default owners, and timeouts. No authentication required — this is schema metadata.
func (s *ReadinessHTTPServer) handleCatalog(w http.ResponseWriter) {
	entries := make([]CatalogEntry, 0, len(registeredChecks))
	for _, c := range registeredChecks {
		entry := CatalogEntry{
			Name:        c.Name(),
			Description: c.Description(),
			Owner:       string(c.DefaultOwner()),
		}
		if t := c.DefaultTimeout(); t > 0 {
			entry.TimeoutSecs = int(t.Seconds())
		}
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checks": entries,
		"total":  len(entries),
	})
}

func (s *ReadinessHTTPServer) handleCreate(w http.ResponseWriter, r *http.Request, token string) {
	ctx := r.Context()
	if err := s.authorizeToken(ctx, token, "create"); err != nil {
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}

	var req CheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateCheckRequest(req); err != nil {
		http.Error(w, "Bad request: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Clean up expired checks before enforcing limit (opportunistic cleanup)
	s.cleanupExpiredChecks(ctx)

	// Enforce limit: max 2 active readiness checks at a time
	if err := s.checkActiveLimit(ctx); err != nil {
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	}

	requestID := uuid.New().String()
	cr := s.buildInternalCR(requestID, req)
	if err := s.Client.Create(ctx, cr); err != nil {
		s.Logger.Error(err, "Failed to create UpgradeReadinessCheck", "requestId", requestID)
		http.Error(w, "Internal error creating readiness check", http.StatusInternalServerError)
		return
	}

	s.Logger.Info("Readiness check created via HTTP", "requestId", requestID, "crName", cr.Name)

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"requestId": requestID,
		"status":    "accepted",
		"statusUrl": fmt.Sprintf("/api/v1/readiness-checks/%s", requestID),
		"message":   "Readiness check accepted",
	})
}

func (s *ReadinessHTTPServer) handleGet(w http.ResponseWriter, r *http.Request, token, requestID string) {
	ctx := r.Context()
	if err := s.authorizeToken(ctx, token, "get"); err != nil {
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}
	cr, err := s.findCR(ctx, requestID)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, buildResponse(requestID, cr))
}

func (s *ReadinessHTTPServer) handleList(w http.ResponseWriter, r *http.Request, token string) {
	ctx := r.Context()
	if err := s.authorizeToken(ctx, token, "list"); err != nil {
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}

	list := &upgradev1alpha1.UpgradeReadinessCheckList{}
	if err := s.Client.List(ctx, list,
		client.InNamespace(s.Namespace),
		client.HasLabels{requestIDLabel},
	); err != nil {
		http.Error(w, "Internal error listing checks", http.StatusInternalServerError)
		return
	}

	responses := make([]CheckResponse, 0, len(list.Items))
	for i := range list.Items {
		cr := &list.Items[i]
		rid := cr.Labels[requestIDLabel]
		responses = append(responses, buildResponse(rid, cr))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requests": responses,
		"total":    len(responses),
	})
}

func (s *ReadinessHTTPServer) handleDelete(w http.ResponseWriter, r *http.Request, token, requestID string) {
	ctx := r.Context()
	if err := s.authorizeToken(ctx, token, "delete"); err != nil {
		http.Error(w, "Forbidden: "+err.Error(), http.StatusForbidden)
		return
	}
	cr, err := s.findCR(ctx, requestID)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if err := s.Client.Delete(ctx, cr); err != nil {
		s.Logger.Error(err, "Failed to delete UpgradeReadinessCheck", "requestId", requestID)
		http.Error(w, "Internal error deleting readiness check", http.StatusInternalServerError)
		return
	}
	s.Logger.Info("Readiness check deleted via HTTP", "requestId", requestID, "crName", cr.Name)
	w.WriteHeader(http.StatusNoContent)
}

// cleanupExpiredChecks deletes readiness checks that have passed their TTL.
// This runs opportunistically when new requests come in to avoid resource buildup.
func (s *ReadinessHTTPServer) cleanupExpiredChecks(ctx context.Context) {
	list := &upgradev1alpha1.UpgradeReadinessCheckList{}
	if err := s.Client.List(ctx, list,
		client.InNamespace(s.Namespace),
		client.HasLabels{requestIDLabel},
	); err != nil {
		s.Logger.Error(err, "Failed to list checks for cleanup")
		return
	}

	now := time.Now()
	for i := range list.Items {
		cr := &list.Items[i]
		deleteAfter := cr.Annotations["readiness.managed.openshift.io/delete-after"]
		if deleteAfter == "" {
			continue
		}
		expiryTime, err := time.Parse(time.RFC3339, deleteAfter)
		if err != nil {
			s.Logger.Error(err, "Invalid delete-after annotation", "crName", cr.Name, "deleteAfter", deleteAfter)
			continue
		}
		if now.After(expiryTime) {
			if err := s.Client.Delete(ctx, cr); err != nil {
				s.Logger.Error(err, "Failed to delete expired check", "crName", cr.Name)
			} else {
				s.Logger.Info("Deleted expired readiness check", "crName", cr.Name, "expiry", deleteAfter)
			}
		}
	}
}

// checkActiveLimit enforces a maximum of 10 active readiness checks to prevent resource exhaustion.
// Returns an error with instructions if the limit is reached.
func (s *ReadinessHTTPServer) checkActiveLimit(ctx context.Context) error {
	const maxActiveChecks = 10
	list := &upgradev1alpha1.UpgradeReadinessCheckList{}
	if err := s.Client.List(ctx, list,
		client.InNamespace(s.Namespace),
		client.HasLabels{requestIDLabel},
	); err != nil {
		return fmt.Errorf("internal error checking active checks: %w", err)
	}
	if len(list.Items) >= maxActiveChecks {
		return fmt.Errorf("too many active readiness checks (%d/%d). List existing checks with GET /api/v1/readiness-checks and delete completed ones with DELETE /api/v1/readiness-checks/{id} before creating new checks", len(list.Items), maxActiveChecks)
	}
	return nil
}

// authorizeToken performs TokenReview (authn) then SubjectAccessReview (authz).
// verb should be "create", "get", "list", or "delete".
func (s *ReadinessHTTPServer) authorizeToken(ctx context.Context, token, verb string) error {
	tr := &authnv1.TokenReview{Spec: authnv1.TokenReviewSpec{Token: token}}
	if err := s.Client.Create(ctx, tr); err != nil {
		return fmt.Errorf("token review: %w", err)
	}
	if !tr.Status.Authenticated {
		return fmt.Errorf("unauthenticated")
	}

	extra := make(map[string]authzv1.ExtraValue, len(tr.Status.User.Extra))
	for k, v := range tr.Status.User.Extra {
		extra[k] = authzv1.ExtraValue(v)
	}

	sar := &authzv1.SubjectAccessReview{
		Spec: authzv1.SubjectAccessReviewSpec{
			User:   tr.Status.User.Username,
			Groups: tr.Status.User.Groups,
			Extra:  extra,
			ResourceAttributes: &authzv1.ResourceAttributes{
				Namespace: s.Namespace,
				Verb:      verb,
				Group:     "upgrade.managed.openshift.io",
				Resource:  "upgradereadinesschecks",
			},
		},
	}
	if err := s.Client.Create(ctx, sar); err != nil {
		return fmt.Errorf("subject access review: %w", err)
	}
	if !sar.Status.Allowed {
		reason := sar.Status.Reason
		if reason == "" {
			reason = "not allowed"
		}
		return fmt.Errorf("%s", reason)
	}
	return nil
}

func (s *ReadinessHTTPServer) findCR(ctx context.Context, requestID string) (*upgradev1alpha1.UpgradeReadinessCheck, error) {
	list := &upgradev1alpha1.UpgradeReadinessCheckList{}
	if err := s.Client.List(ctx, list,
		client.InNamespace(s.Namespace),
		client.MatchingLabels{requestIDLabel: requestID},
	); err != nil {
		return nil, err
	}
	if len(list.Items) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return &list.Items[0], nil
}

// crNamePrefix returns a sanitized GenerateName value.
// If raw is a valid non-empty caller-supplied prefix it is used as-is.
// Otherwise a descriptive prefix is derived from version and platform:
//
//	version="4.22.22", platform="OSD" → "urc-4-22-22-osd-"
func crNamePrefix(raw, version, platform string) string {
	sanitize := func(s string) string {
		s = strings.ToLower(s)
		var b strings.Builder
		for _, r := range s {
			switch {
			case r == '.' || r == '_':
				b.WriteRune('-')
			case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-':
				b.WriteRune(r)
			}
		}
		return strings.Trim(b.String(), "-")
	}
	if p := sanitize(raw); p != "" {
		return p + "-"
	}
	ver := sanitize(version)
	plat := sanitize(platform)
	switch {
	case ver != "" && plat != "":
		return fmt.Sprintf("urc-%s-%s-", ver, plat)
	case ver != "":
		return fmt.Sprintf("urc-%s-", ver)
	default:
		return "urc-"
	}
}

func (s *ReadinessHTTPServer) buildInternalCR(requestID string, req CheckRequest) *upgradev1alpha1.UpgradeReadinessCheck {
	annotations := map[string]string{
		// Auto-delete after 24 hours to prevent resource buildup
		"readiness.managed.openshift.io/delete-after": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
	}
	if req.Description != "" {
		annotations["readiness.managed.openshift.io/description"] = req.Description
	}
	return &upgradev1alpha1.UpgradeReadinessCheck{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: crNamePrefix(req.NamePrefix, req.TargetVersion, req.Platform),
			Namespace:    s.Namespace,
			Labels:       map[string]string{requestIDLabel: requestID},
			Annotations:  annotations,
		},
		Spec: upgradev1alpha1.UpgradeReadinessCheckSpec{
			UpgradeConfigSpec: upgradev1alpha1.UpgradeConfigSpec{
				Type:                 upgradev1alpha1.UpgradeType(req.Platform),
				Desired:              upgradev1alpha1.Update{Version: req.TargetVersion, Channel: req.TargetChannel},
				UpgradeAt:            time.Now().Format(time.RFC3339),
				PDBForceDrainTimeout: 60,
			},
			DefaultCheckTimeoutSeconds: req.DefaultCheckTimeoutSeconds,
			OverallTimeoutSeconds:      req.OverallTimeoutSeconds,
			Checks:                     req.ChecksToRun,
		},
	}
}

func buildResponse(requestID string, cr *upgradev1alpha1.UpgradeReadinessCheck) CheckResponse {
	status := "pending"
	if cr.Status.StartedAt != nil {
		status = "running"
	}
	if cr.Status.CompletedAt != nil {
		status = "completed"
	}

	resp := CheckResponse{
		RequestID:     requestID,
		Status:        status,
		StartedAt:     cr.Status.StartedAt,
		CompletedAt:   cr.Status.CompletedAt,
		TargetVersion: cr.Spec.Desired.Version,
		TargetChannel: cr.Spec.Desired.Channel,
		Platform:      string(cr.Spec.Type),
		ChecksTotal:   len(cr.Status.Checks),
	}

	anyBad := false
	anyWarning := false
	for _, c := range cr.Status.Checks {
		r := CheckResult{Name: c.Name, Owner: string(c.Owner), Action: c.Action}
		switch c.Execution.State {
		case upgradev1alpha1.CheckCompleted:
			resp.ChecksCompleted++
			r.Status = strings.ToLower(string(c.Result))
			r.Message = c.Execution.Summary
			r.Details = c.Execution.Findings
			switch c.Result {
			case upgradev1alpha1.CheckFailed:
				resp.ChecksFailed++
				anyBad = true
			case upgradev1alpha1.CheckResultWarning:
				resp.ChecksWarned++
				anyWarning = true
			default:
				resp.ChecksPassed++
			}
		case upgradev1alpha1.CheckError:
			resp.ChecksErrored++
			anyBad = true
			r.Status = "error"
			r.Message = c.Execution.Error
		case upgradev1alpha1.CheckSkipped:
			resp.ChecksSkipped++
			r.Status = "skipped"
		}
		resp.Results = append(resp.Results, r)
	}

	if cr.Status.CompletedAt != nil {
		switch {
		case anyBad:
			resp.OverallStatus = "failed"
			resp.Message = fmt.Sprintf("Upgrade not recommended — %d check(s) failed, %d errored",
				resp.ChecksFailed, resp.ChecksErrored)
		case anyWarning:
			resp.OverallStatus = "warning"
			resp.Message = fmt.Sprintf("Upgrade may proceed — %d check(s) returned warnings, review findings before upgrading",
				resp.ChecksWarned)
		default:
			resp.OverallStatus = "passed"
			resp.Message = "Cluster is ready for upgrade"
		}
	}
	return resp
}

func validateCheckRequest(req CheckRequest) error {
	if req.TargetVersion == "" {
		return fmt.Errorf("targetVersion is required")
	}
	if req.TargetChannel == "" {
		return fmt.Errorf("targetChannel is required")
	}
	if req.Platform != "OSD" && req.Platform != "ARO" {
		return fmt.Errorf("platform must be OSD or ARO, got %q", req.Platform)
	}
	if req.DefaultCheckTimeoutSeconds < 0 {
		return fmt.Errorf("defaultCheckTimeoutSeconds must be >= 0, got %d", req.DefaultCheckTimeoutSeconds)
	}
	if req.OverallTimeoutSeconds < 0 {
		return fmt.Errorf("overallTimeoutSeconds must be >= 0, got %d", req.OverallTimeoutSeconds)
	}
	if len(req.ChecksToRun) > 0 {
		valid := make(map[string]struct{}, len(registeredChecks))
		for _, c := range registeredChecks {
			valid[c.Name()] = struct{}{}
		}
		var unknown []string
		for _, name := range req.ChecksToRun {
			if _, ok := valid[name]; !ok {
				unknown = append(unknown, name)
			}
		}
		if len(unknown) > 0 {
			known := make([]string, 0, len(registeredChecks))
			for _, c := range registeredChecks {
				known = append(known, c.Name())
			}
			return fmt.Errorf("unknown check name(s) in checksToRun: %v — valid names: %v", unknown, known)
		}
	}
	return nil
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
