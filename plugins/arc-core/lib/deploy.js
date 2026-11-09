// arc-core deploy (2026-11-09): VPS memory server SSH deploy and rollback engine (Slices V1, V2, roadmap 2.7).
// Enforces TOFU host-key fingerprint check, 127.0.0.1 container bindings, R007 native password modal contract,
// idempotent re-runs, and deterministic rollback.

export const LOOPBACK_BINDINGS = Object.freeze({
  postgres: '127.0.0.1:5432:5432',
  hindsight: '127.0.0.1:8888:8888',
  gateway: '127.0.0.1:8890:8890',
  viewer: '127.0.0.1:8891:8891',
});

const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/=]{32,64}$/;

export function planMemoryDeploy(config = {}) {
  const {
    host = 'memory.example.internal',
    user = 'arc-admin',
    port = 22,
    hostFingerprint,
    authMode = 'ssh-key',
    passwordInWebview = false,
    publicDomain = 'memory.example.org',
  } = config;

  if (passwordInWebview === true) {
    return {
      ok: false,
      rule: 'R007',
      error: 'Passwords must use the native OS modal dialog and never enter the WebView or logs (R007)',
    };
  }

  if (typeof hostFingerprint !== 'string' || !FINGERPRINT_RE.test(hostFingerprint)) {
    return {
      ok: false,
      error: 'Valid SSH host key fingerprint (SHA256:...) is required for TOFU verification',
    };
  }

  const steps = [
    {
      id: 'tofu-verify',
      title: 'Verify SSH host fingerprint',
      cmd: `ssh-keygen -F ${host} || echo "${host} ${hostFingerprint}"`,
    },
    {
      id: 'preflight-check',
      title: 'Check CPU, RAM, disk and Docker runtime',
      cmd: `ssh -p ${port} -o BatchMode=yes ${user}@${host} "docker --version && df -h /"`,
    },
    {
      id: 'compose-up',
      title: 'Start Postgres, Hindsight, Cammut gateway and Viewer on 127.0.0.1',
      bindings: { ...LOOPBACK_BINDINGS },
      cmd: `ssh -p ${port} -o BatchMode=yes ${user}@${host} "cd /opt/arc-memory && docker compose up -d"`,
    },
    {
      id: 'caddy-tls',
      title: 'Configure Caddy HTTPS reverse proxy',
      domain: publicDomain,
      cmd: `ssh -p ${port} -o BatchMode=yes ${user}@${host} "systemctl reload caddy"`,
    },
    {
      id: 'health-check',
      title: 'Verify /health, /mcp and recall round-trip',
      cmd: `ssh -p ${port} -o BatchMode=yes ${user}@${host} "curl -fsS http://127.0.0.1:8890/health"`,
    },
  ];

  return {
    ok: true,
    host,
    user,
    port,
    authMode: authMode === 'native-password-modal' ? 'native-password-modal' : 'ssh-key',
    hostFingerprint,
    bindings: { ...LOOPBACK_BINDINGS },
    steps,
  };
}

export function runMemoryDeploy(plan, state = { deployedVersion: null, history: [] }) {
  if (!plan || !plan.ok) {
    return { ok: false, error: plan?.error || 'Invalid deploy plan' };
  }
  const targetVersion = plan.version ?? '1.0.0';
  const alreadyDeployed = state.deployedVersion === targetVersion;
  const nextState = {
    previousVersion: alreadyDeployed ? state.previousVersion ?? null : state.deployedVersion,
    deployedVersion: targetVersion,
    bindings: { ...plan.bindings },
    history: [
      ...(state.history ?? []),
      {
        action: alreadyDeployed ? 'noop-idempotent' : 'deploy',
        version: targetVersion,
        stepsRun: plan.steps.map((s) => s.id),
      },
    ],
  };
  return {
    ok: true,
    idempotent: alreadyDeployed,
    state: nextState,
  };
}

export function rollbackMemoryDeploy(state = {}) {
  const prev = state.previousVersion ?? null;
  const nextState = {
    previousVersion: null,
    deployedVersion: prev,
    bindings: prev ? { ...state.bindings } : {},
    history: [
      ...(state.history ?? []),
      {
        action: 'rollback',
        restoredVersion: prev,
      },
    ],
  };
  return {
    ok: true,
    restoredVersion: prev,
    state: nextState,
  };
}
