package upgradediags

import (
	"context"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// namespacePlatformCache classifies namespaces as Red Hat platform-managed vs
// customer-managed for a single check run. Results are cached to avoid repeated
// API calls when iterating over many pods or PDBs.
//
// Classification order:
//  1. Known Kubernetes core namespaces → platform
//  2. openshift-* prefix → platform (correct for the vast majority of cases)
//  3. Otherwise: fetch the namespace object and inspect managedFields.manager
//     for known Red Hat / Hive / addon manager name prefixes → platform
//  4. Anything else → customer
//
// NOTE: this helper is intentionally scoped to the upgradediags package.
// The existing upgrade path (pkg/upgraders) uses its own namespace logic and
// must NOT be changed here.
type namespacePlatformCache struct {
	client client.Client
	cache  map[string]bool
}

func newNamespacePlatformCache(c client.Client) *namespacePlatformCache {
	return &namespacePlatformCache{client: c, cache: make(map[string]bool)}
}

// IsPlatform returns true if the namespace is managed by the OpenShift platform
// (Red Hat), false if it is a customer namespace.
func (npc *namespacePlatformCache) IsPlatform(ctx context.Context, ns string) bool {
	if v, ok := npc.cache[ns]; ok {
		return v
	}
	v := isPlatformNamespace(ctx, npc.client, ns)
	npc.cache[ns] = v
	return v
}

// isPlatformNamespace is the uncached implementation used by namespacePlatformCache.
func isPlatformNamespace(ctx context.Context, c client.Client, ns string) bool {
	// Kubernetes core namespaces are always platform-managed.
	switch ns {
	case "default", "kube-system", "kube-public", "kube-node-lease":
		return true
	}

	// The openshift-* prefix is the dominant signal and is accurate for
	// the vast majority of platform namespaces.
	if strings.HasPrefix(ns, "openshift-") {
		return true
	}

	// For namespaces without the openshift-* prefix (Hive-created cluster
	// namespaces, addon-operator namespaces, ACM/ACS hub namespaces, etc.),
	// fetch the namespace object and check its managedFields manager names.
	// This avoids a static exception list that would go stale as the fleet evolves.
	nsObj := &corev1.Namespace{}
	if err := c.Get(ctx, types.NamespacedName{Name: ns}, nsObj); err != nil {
		return false
	}
	return hasPlatformManagedFields(nsObj.ManagedFields)
}

// platformManagerPrefixes are field-manager name prefixes that indicate a
// namespace was created or is owned by the OpenShift platform or a Red Hat
// operator. The list is intentionally prefix-based so new operators are
// detected without a code change.
var platformManagerPrefixes = []string{
	"cluster-version-operator",
	"hive",       // Hive creates namespaces for each managed cluster
	"openshift-", // openshift-* controllers (OLM, MCO, addon-operator, etc.)
	"redhat-",    // Red Hat-branded operators (redhat-acs, redhat-acm, etc.)
}

func hasPlatformManagedFields(fields []metav1.ManagedFieldsEntry) bool {
	for _, f := range fields {
		for _, prefix := range platformManagerPrefixes {
			if strings.HasPrefix(f.Manager, prefix) {
				return true
			}
		}
	}
	return false
}
