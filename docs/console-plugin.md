# Console Plugin — Upgrade Preflight Checks

The MUO ships an optional OpenShift Console dynamic plugin that lets cluster administrators run and review upgrade preflight checks directly from the web UI without needing CLI access.

## What It Does

- **List view** — shows all `UpgradePreflightCheck` CRs with live status updates
- **Detail view** — expand any row to see per-check results, findings, and recommended actions
- **Create form** — "Run New Check" modal with version, channel, and platform fields
- **Status badges** — Passed (green), Warning (orange), Failed (red)

Reads use the user's own browser session token — per-user RBAC is enforced automatically. Creates go through the MUO HTTP service, which performs TokenReview + SubjectAccessReview before creating the CR.

## Enabling the Plugin

After deploying MUO, enable the plugin in the console operator:

```bash
oc patch console.operator cluster \
  --type=merge -p '{"spec":{"plugins":["managed-upgrade-operator"]}}'
```

The plugin appears under **Administration → Preflight Checks** in the left nav within about 30 seconds (the console reloads the plugin list automatically).

Verify it is enabled:

```bash
oc get console.operator cluster -o jsonpath='{.spec.plugins}'
```

## Accessing the Plugin

Navigate to the OpenShift Console → **Administration → Preflight Checks**.

If the nav item is not visible:
1. Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R)
2. Check the plugin is registered: `oc get consoleplugin managed-upgrade-operator`
3. Check the plugin is enabled: `oc get console.operator cluster -o jsonpath='{.spec.plugins}'`
4. Check the MUO pod is running and serving `/plugin-manifest.json`:
   ```bash
   MUO_POD=$(oc -n openshift-managed-upgrade-operator get pod -l name=managed-upgrade-operator \
     -o jsonpath='{.items[0].metadata.name}')
   oc exec -n openshift-managed-upgrade-operator $MUO_POD -- \
     curl -sk https://localhost:8443/plugin-manifest.json | head -5
   ```

## Running a Preflight Check

1. Click **Run New Check**
2. Enter the **Target Version** (e.g. `4.17.3`)
3. Enter the **Channel** (e.g. `stable-4.17`)
4. Select **Platform** (OSD or ARO)
5. Click **Run Checks**

The new row appears immediately with a spinner. When all checks complete the status badge updates and the row is expandable.

## Reading Results

Click the expand arrow on any row to see:
- Per-check status badge
- Summary of what the check found
- Findings list (alert names, operator names, risk details, etc.)
- Recommended action when a check fails

## RBAC

| Group | get/list/watch | create |
|---|---|---|
| `dedicated-admins` | ✅ | ❌ (via HTTP service) |
| `cluster-admins` | ✅ | ❌ (via HTTP service) |
| OCM Agent SA | ✅ | ✅ |
| MUO operator SA | ✅ | ✅ |

## Local Development

```bash
cd consoleplugin/
npm install
npm run dev        # webpack dev server on :9001
```

The dev server proxies API calls to the cluster. You will need a running OpenShift cluster accessible from your machine and an active `oc login` session. Configure the proxy target in `webpack.config.js` `devServer.proxy` to point to your cluster's console URL.

## Architecture

```
Browser (user session token)
  │
  ├── K8s API reads ──────────────────────────► kube-apiserver
  │   (useK8sWatchResource / k8sList)           RBAC enforced per user
  │
  └── Creates (POST) ──► console proxy ──────► MUO HTTP service (:8443)
      /api/proxy/plugin/                        TokenReview + SAR
      managed-upgrade-operator/                 → creates CR via operator SA
      preflight-api/...
```

The plugin bundle is built into the MUO container image at `/usr/share/consoleplugin/` and served by the MUO HTTP service at `/plugin-manifest.json` and `/assets/*`.
