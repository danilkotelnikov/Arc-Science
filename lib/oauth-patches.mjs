// OAuth provider, backend RPC, and Settings UI patches for Arc Harness.
// Applied during tools/build.mjs (before brand/clean-room rewrites so patch 16/17 rename @deepseek-ai/dsh-* -> @arc-harness/arc-*).

const DS = 'dsh/node_modules/@deepseek-ai/';
const PI = 'dsh/node_modules/@earendil-works/pi-ai/';

function replaceOnce(code, find, repl, what) {
  if (typeof find === 'string') {
    const n = code.split(find).length - 1;
    if (n !== 1) throw new Error(`oauth-patches: ${what}: expected 1 match, found ${n}`);
    return code.replace(find, () => repl);
  }
  const flags = find.flags.includes('g') ? find.flags : find.flags + 'g';
  const matches = [...code.matchAll(new RegExp(find.source, flags))];
  if (matches.length !== 1) throw new Error(`oauth-patches: ${what}: expected 1 match, found ${matches.length}`);
  return code.replace(find, repl);
}

// ---------------------------------------------------------------------------
// 1. pi-ai OAuth flows (Google/Vertex PKCE + ADC, Qwen Device PKCE, MiniMax PKCE)
// ---------------------------------------------------------------------------
const PI_AI_EXTRA_OAUTH = `
import { readFile as _arcReadFile } from "node:fs/promises";
import { homedir as _arcHomedir } from "node:os";
import { join as _arcJoin } from "node:path";
import { startOAuthCallbackServer as _arcStartCb, waitForCallbackOrManualInput as _arcWaitCb } from "./callback-server.js";
import { pollOAuthDeviceCodeFlow as _arcPollDevice } from "./device-code.js";
import { generatePKCE as _arcGenPKCE } from "./pkce.js";

function _arcRandomState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString("base64url");
}

function _arcDefaultAdcPath() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (process.platform === "win32" && process.env.APPDATA) {
        return _arcJoin(process.env.APPDATA, "gcloud", "application_default_credentials.json");
    }
    return _arcJoin(_arcHomedir(), ".config", "gcloud", "application_default_credentials.json");
}

function _arcParseGoogleClientInput(rawId, rawSecret) {
    const trimmed = String(rawId || "").trim();
    if (!trimmed) throw new Error("Google OAuth Client ID is required.");
    if (trimmed.startsWith("{")) {
        let parsed;
        try { parsed = JSON.parse(trimmed); } catch { throw new Error("Invalid Google OAuth client JSON."); }
        const block = parsed?.installed ?? parsed?.web ?? parsed;
        const cid = typeof block?.client_id === "string" ? block.client_id.trim() : "";
        const csec = typeof block?.client_secret === "string" ? block.client_secret.trim() : "";
        if (!cid) throw new Error("The pasted JSON does not contain client_id.");
        return { clientId: cid, clientSecret: csec || undefined };
    }
    const sec = typeof rawSecret === "string" ? rawSecret.trim() : "";
    return { clientId: trimmed, clientSecret: sec || undefined };
}

async function _arcExchangeGoogleToken(params, signal) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!response.ok || typeof json?.access_token !== "string") {
        const detail = json?.error_description || json?.error || text || response.statusText;
        throw new Error(\`Google OAuth token exchange failed (\${response.status}): \${detail}\`);
    }
    const expiresIn = typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
    return {
        access: json.access_token,
        refresh: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : undefined,
        expires: Date.now() + expiresIn * 1000 - 3 * 60 * 1000,
    };
}

function _arcNormalizeGoogleManualCode(input, expectedState) {
    const trimmed = String(input || "").trim();
    if (!trimmed) throw new Error("Missing authorization code.");
    try {
        const u = new URL(trimmed);
        const err = u.searchParams.get("error");
        if (err) throw new Error(\`Google authorization failed: \${err}\`);
        const st = u.searchParams.get("state");
        if (st && st !== expectedState) throw new Error("Google OAuth state mismatch.");
        const code = u.searchParams.get("code");
        if (!code) throw new Error("Redirect URL did not include a code parameter.");
        return code;
    } catch (e) {
        if (e instanceof Error && (e.message.startsWith("Google ") || e.message.startsWith("Redirect "))) throw e;
        return trimmed;
    }
}

export const loadGoogleOAuth = async (mode = "google") => {
    const isVertex = mode === "google-vertex";
    const scopes = isVertex
        ? "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email"
        : "https://www.googleapis.com/auth/generative-language.retriever https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email";

    async function refresh(credential, signal) {
        if (!credential?.refresh || !credential?.clientId) {
            throw new Error("Stored Google OAuth credential cannot refresh; sign in again.");
        }
        const params = {
            grant_type: "refresh_token",
            client_id: credential.clientId,
            refresh_token: credential.refresh,
        };
        if (credential.clientSecret) params.client_secret = credential.clientSecret;
        const token = await _arcExchangeGoogleToken(params, signal);
        return {
            ...credential,
            type: "oauth",
            access: token.access,
            refresh: token.refresh ?? credential.refresh,
            expires: token.expires,
        };
    }

    async function loginBrowser(interaction) {
        const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        let clientId = envId;
        let clientSecret = envSecret;
        if (!clientId) {
            const rawId = await interaction.prompt({
                type: "text",
                message: "Enter Google OAuth Client ID (or paste client_secret.json):",
                placeholder: "1234567890-abc.apps.googleusercontent.com",
                signal: interaction.signal,
            });
            const parsed = _arcParseGoogleClientInput(rawId, undefined);
            clientId = parsed.clientId;
            clientSecret = parsed.clientSecret;
            if (!clientSecret) {
                const rawSecret = await interaction.prompt({
                    type: "secret",
                    message: "Enter Google OAuth Client Secret (leave blank for PKCE-only clients):",
                    placeholder: "GOCSPX-... (optional)",
                    signal: interaction.signal,
                });
                if (rawSecret && rawSecret.trim()) clientSecret = rawSecret.trim();
            }
        }
        let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
        if (!projectId || isVertex) {
            const askedProject = await interaction.prompt({
                type: "text",
                message: isVertex
                    ? "Enter Google Cloud Project ID:"
                    : "Enter Google Cloud Project ID (optional, for quota billing):",
                placeholder: projectId || "my-gcp-project",
                signal: interaction.signal,
            });
            if (askedProject && askedProject.trim()) projectId = askedProject.trim();
        }
        let location = process.env.GOOGLE_CLOUD_LOCATION || "global";
        if (isVertex) {
            const askedLoc = await interaction.prompt({
                type: "text",
                message: "Enter Google Cloud Location (default: global):",
                placeholder: location,
                signal: interaction.signal,
            });
            if (askedLoc && askedLoc.trim()) location = askedLoc.trim();
        }
        if (isVertex && !projectId) throw new Error("Google Vertex AI requires a Google Cloud Project ID.");

        const { verifier, challenge } = await _arcGenPKCE();
        const state = _arcRandomState();
        const callback = await _arcStartCb({
            providerName: "Google",
            host: "127.0.0.1",
            port: 0,
            path: "/callback",
            redirectHost: "127.0.0.1",
            state,
            complete: async (code) => code,
            signal: interaction.signal,
        }).catch(() => undefined);
        const redirectUri = callback?.redirectUri ?? "http://127.0.0.1/callback";
        try {
            const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
            authUrl.search = new URLSearchParams({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: "code",
                scope: scopes,
                access_type: "offline",
                prompt: "consent",
                code_challenge: challenge,
                code_challenge_method: "S256",
                state,
            }).toString();
            interaction.notify({
                type: "auth_url",
                url: authUrl.toString(),
                instructions: "Complete Google sign-in in your browser. If the callback does not finish automatically, paste the redirect URL here.",
            });
            const result = await _arcWaitCb(interaction, callback, {
                message: "Complete Google sign-in in your browser, or paste the redirect URL / code:",
                placeholder: redirectUri,
            });
            const code = result.type === "callback"
                ? result.value
                : _arcNormalizeGoogleManualCode(result.input, state);
            interaction.notify({ type: "progress", message: "Exchanging Google authorization code..." });
            const params = {
                grant_type: "authorization_code",
                client_id: clientId,
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
            };
            if (clientSecret) params.client_secret = clientSecret;
            const token = await _arcExchangeGoogleToken(params, interaction.signal);
            if (!token.refresh) throw new Error("Google did not issue a refresh token; ensure access_type=offline and prompt=consent.");
            return {
                type: "oauth",
                access: token.access,
                refresh: token.refresh,
                expires: token.expires,
                clientId,
                ...(clientSecret ? { clientSecret } : {}),
                ...(projectId ? { projectId } : {}),
                ...(isVertex ? { location } : {}),
                mode,
            };
        } finally {
            callback?.close();
        }
    }

    async function loginAdc(interaction) {
        const defaultPath = _arcDefaultAdcPath();
        const enteredPath = await interaction.prompt({
            type: "text",
            message: "Path to Google Application Default Credentials JSON (leave blank for default):",
            placeholder: defaultPath,
            signal: interaction.signal,
        });
        const adcPath = (enteredPath && enteredPath.trim()) || defaultPath;
        let raw;
        try {
            raw = JSON.parse(await _arcReadFile(adcPath, "utf8"));
        } catch (err) {
            throw new Error(\`Could not read Google ADC file at \${adcPath}: \${err instanceof Error ? err.message : String(err)}\`);
        }
        if (raw?.type !== "authorized_user" || !raw?.client_id || !raw?.refresh_token) {
            throw new Error("ADC file must be an authorized_user credential from \`gcloud auth application-default login\`.");
        }
        let projectId = raw.quota_project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
        const askedProject = await interaction.prompt({
            type: "text",
            message: isVertex
                ? "Enter Google Cloud Project ID (leave blank for detected):"
                : "Enter Google Cloud Project ID (optional; leave blank for detected):",
            placeholder: projectId || "my-gcp-project",
            signal: interaction.signal,
        });
        if (askedProject && askedProject.trim()) projectId = askedProject.trim();
        let location = process.env.GOOGLE_CLOUD_LOCATION || "global";
        if (isVertex) {
            const askedLoc = await interaction.prompt({
                type: "text",
                message: "Enter Google Cloud Location (leave blank for global):",
                placeholder: location,
                signal: interaction.signal,
            });
            if (askedLoc && askedLoc.trim()) location = askedLoc.trim();
        }
        if (isVertex && !projectId) throw new Error("Google Vertex AI requires a Google Cloud Project ID.");
        interaction.notify({ type: "progress", message: "Refreshing Google ADC OAuth token..." });
        const params = {
            grant_type: "refresh_token",
            client_id: raw.client_id,
            refresh_token: raw.refresh_token,
        };
        if (raw.client_secret) params.client_secret = raw.client_secret;
        const token = await _arcExchangeGoogleToken(params, interaction.signal);
        return {
            type: "oauth",
            access: token.access,
            refresh: token.refresh ?? raw.refresh_token,
            expires: token.expires,
            clientId: raw.client_id,
            ...(raw.client_secret ? { clientSecret: raw.client_secret } : {}),
            ...(projectId ? { projectId } : {}),
            ...(isVertex ? { location } : {}),
            mode,
        };
    }

    return {
        name: isVertex ? "Google Cloud Vertex AI (OAuth / ADC)" : "Google Gemini (OAuth / ADC)",
        isSubscription: false,
        loginLabel: isVertex ? "Sign in with Google Cloud" : "Sign in with Google",
        async login(interaction) {
            const method = await interaction.prompt({
                type: "select",
                message: "Select Google authentication method:",
                options: [
                    { id: "browser", label: "Google OAuth 2.0 (Browser PKCE)" },
                    { id: "adc", label: "Import gcloud ADC (application_default_credentials.json)" },
                ],
                signal: interaction.signal,
            });
            if (method === "adc") return loginAdc(interaction);
            if (method === "browser") return loginBrowser(interaction);
            throw new Error(\`Unknown Google login method: \${method}\`);
        },
        refresh,
        async toAuth(credential) {
            const headers = { Authorization: \`Bearer \${credential.access}\` };
            if (credential.projectId) headers["x-goog-user-project"] = credential.projectId;
            const out = { headers };
            if (isVertex && (credential.projectId || credential.location)) {
                out.env = {
                    ...(credential.projectId ? { GOOGLE_CLOUD_PROJECT: credential.projectId } : {}),
                    ...(credential.location ? { GOOGLE_CLOUD_LOCATION: credential.location } : {}),
                };
            }
            return out;
        },
    };
};

const _ARC_QWEN_DEVICE_URL = "https://chat.qwen.ai/api/v1/oauth2/device/code";
const _ARC_QWEN_TOKEN_URL = "https://chat.qwen.ai/api/v1/oauth2/token";
const _ARC_QWEN_SCOPE = "openid profile email model.completion";
const _ARC_QWEN_DEFAULT_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";

function _arcNormalizeQwenBaseUrl(resourceUrl) {
    if (typeof resourceUrl !== "string" || !resourceUrl.trim()) return "https://portal.qwen.ai/v1";
    const raw = resourceUrl.trim().replace(/\\/+$/, "");
    const withProto = /^https?:\\/\\//i.test(raw) ? raw : \`https://\${raw}\`;
    return withProto.endsWith("/v1") ? withProto : \`\${withProto}/v1\`;
}

export const loadQwenOAuth = async () => {
    const clientId = process.env.QWEN_OAUTH_CLIENT_ID || _ARC_QWEN_DEFAULT_CLIENT_ID;
    async function refresh(credential, signal) {
        const response = await fetch(_ARC_QWEN_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: credential.refresh,
                client_id: clientId,
            }).toString(),
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        if (!response.ok || typeof json?.access_token !== "string") {
            throw new Error(\`Qwen OAuth refresh failed (\${response.status}): \${json?.error_description || json?.error || text}\`);
        }
        const expiresIn = typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
        return {
            type: "oauth",
            access: json.access_token,
            refresh: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : credential.refresh,
            expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
            ...(json.resource_url ? { resourceUrl: json.resource_url } : credential.resourceUrl ? { resourceUrl: credential.resourceUrl } : {}),
        };
    }

    return {
        name: "Qwen (OAuth)",
        isSubscription: true,
        loginLabel: "Sign in with Qwen",
        async login(interaction) {
            const { verifier, challenge } = await _arcGenPKCE();
            const startRes = await fetch(_ARC_QWEN_DEVICE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                body: new URLSearchParams({
                    client_id: clientId,
                    scope: _ARC_QWEN_SCOPE,
                    code_challenge: challenge,
                    code_challenge_method: "S256",
                }).toString(),
                signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(30_000)]),
            });
            const startText = await startRes.text();
            let device = null;
            try { device = JSON.parse(startText); } catch {}
            if (!startRes.ok || !device?.device_code || !device?.user_code) {
                throw new Error(\`Qwen OAuth device authorization failed (\${startRes.status}): \${device?.error_description || device?.error || startText}\`);
            }
            const verificationUri = device.verification_uri_complete || device.verification_uri || "https://chat.qwen.ai/authorize";
            interaction.notify({
                type: "device_code",
                userCode: device.user_code,
                verificationUri,
                intervalSeconds: typeof device.interval === "number" && device.interval > 0 ? device.interval : 2,
                expiresInSeconds: typeof device.expires_in === "number" && device.expires_in > 0 ? device.expires_in : 300,
            });
            return _arcPollDevice({
                intervalSeconds: typeof device.interval === "number" && device.interval > 0 ? device.interval : 2,
                expiresInSeconds: typeof device.expires_in === "number" && device.expires_in > 0 ? device.expires_in : 300,
                waitBeforeFirstPoll: true,
                signal: interaction.signal,
                poll: async () => {
                    const res = await fetch(_ARC_QWEN_TOKEN_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                        body: new URLSearchParams({
                            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                            client_id: clientId,
                            device_code: device.device_code,
                            code_verifier: verifier,
                        }).toString(),
                        signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(30_000)]),
                    });
                    const bodyText = await res.text();
                    let json = null;
                    try { json = JSON.parse(bodyText); } catch {}
                    if (res.ok && typeof json?.access_token === "string" && json.access_token) {
                        const expiresIn = typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
                        return {
                            status: "complete",
                            value: {
                                type: "oauth",
                                access: json.access_token,
                                refresh: json.refresh_token || "",
                                expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
                                ...(json.resource_url ? { resourceUrl: json.resource_url } : {}),
                            },
                        };
                    }
                    if (json?.error === "authorization_pending") return { status: "pending" };
                    if (json?.error === "slow_down") return { status: "slow_down", intervalSeconds: typeof json.interval === "number" ? json.interval : undefined };
                    if (json?.error === "access_denied") return { status: "failed", message: "Qwen OAuth sign-in was denied." };
                    if (json?.error === "expired_token") return { status: "failed", message: "Qwen OAuth code expired. Please try again." };
                    return { status: "failed", message: \`Qwen OAuth token request failed (\${res.status}): \${json?.error_description || json?.error || bodyText}\` };
                },
            });
        },
        refresh,
        async toAuth(credential) {
            return {
                baseUrl: _arcNormalizeQwenBaseUrl(credential.resourceUrl),
                headers: {
                    Authorization: \`Bearer \${credential.access}\`,
                    "X-DashScope-AuthType": "qwen-oauth",
                    "X-DashScope-CacheControl": "enable",
                    "User-Agent": "QwenCode/0.10.3",
                },
            };
        },
    };
};

const _ARC_MINIMAX_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const _ARC_MINIMAX_SCOPE = "group_id profile model.completion";
const _ARC_MINIMAX_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";

function _arcNormalizeExpiryMs(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return Date.now() + 3600_000;
    if (raw > 1e12) return raw - 60_000;
    if (raw > 1e9) return raw * 1000 - 60_000;
    return Date.now() + raw * 1000 - 60_000;
}

export const loadMiniMaxOAuth = async (region = "global") => {
    const baseUrl = region === "cn" ? "https://api.minimaxi.com" : "https://api.minimax.io";
    const codeEndpoint = \`\${baseUrl}/oauth/code\`;
    const tokenEndpoint = \`\${baseUrl}/oauth/token\`;

    async function refresh(credential, signal) {
        if (!credential?.refresh) throw new Error("MiniMax OAuth session has no refresh token; sign in again.");
        const res = await fetch(tokenEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: _ARC_MINIMAX_CLIENT_ID,
                refresh_token: credential.refresh,
            }).toString(),
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        if (!res.ok || json?.status !== "success" || typeof json?.access_token !== "string") {
            throw new Error(\`MiniMax OAuth refresh failed (\${res.status}): \${json?.base_resp?.status_msg || json?.error_description || text}\`);
        }
        return {
            type: "oauth",
            access: json.access_token,
            refresh: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : credential.refresh,
            expires: _arcNormalizeExpiryMs(json.expired_in),
            ...(json.resource_url ? { resourceUrl: json.resource_url } : credential.resourceUrl ? { resourceUrl: credential.resourceUrl } : {}),
        };
    }

    return {
        name: region === "cn" ? "MiniMax CN (OAuth)" : "MiniMax (OAuth)",
        isSubscription: true,
        loginLabel: region === "cn" ? "Sign in with MiniMax CN" : "Sign in with MiniMax",
        async login(interaction) {
            const { verifier, challenge } = await _arcGenPKCE();
            const state = _arcRandomState();
            const res = await fetch(codeEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                    "x-request-id": crypto.randomUUID(),
                },
                body: new URLSearchParams({
                    response_type: "code",
                    client_id: _ARC_MINIMAX_CLIENT_ID,
                    scope: _ARC_MINIMAX_SCOPE,
                    code_challenge: challenge,
                    code_challenge_method: "S256",
                    state,
                }).toString(),
                signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(30_000)]),
            });
            const text = await res.text();
            let payload = null;
            try { payload = JSON.parse(text); } catch {}
            if (!res.ok || !payload?.user_code || !payload?.verification_uri) {
                throw new Error(\`MiniMax OAuth failed (\${res.status}): \${payload?.error || text}\`);
            }
            if (payload.state && payload.state !== state) {
                throw new Error("MiniMax OAuth state mismatch.");
            }
            const rawInterval = typeof payload.interval === "number" && payload.interval > 0 ? payload.interval : 2000;
            const intervalSeconds = rawInterval > 100 ? Math.max(0.01, rawInterval / 1000) : rawInterval;
            const expiresMs = _arcNormalizeExpiryMs(payload.expired_in);
            const expiresInSeconds = Math.max(60, Math.ceil((expiresMs - Date.now()) / 1000));
            interaction.notify({
                type: "device_code",
                userCode: payload.user_code,
                verificationUri: payload.verification_uri,
                intervalSeconds,
                expiresInSeconds,
            });
            return _arcPollDevice({
                intervalSeconds,
                expiresInSeconds,
                waitBeforeFirstPoll: true,
                signal: interaction.signal,
                poll: async () => {
                    const pollRes = await fetch(tokenEndpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                        body: new URLSearchParams({
                            grant_type: _ARC_MINIMAX_GRANT_TYPE,
                            client_id: _ARC_MINIMAX_CLIENT_ID,
                            user_code: payload.user_code,
                            code_verifier: verifier,
                        }).toString(),
                        signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(30_000)]),
                    });
                    const bodyText = await pollRes.text();
                    let json = null;
                    try { json = JSON.parse(bodyText); } catch {}
                    if (!pollRes.ok) {
                        return { status: "failed", message: \`MiniMax OAuth token error (\${pollRes.status}): \${json?.base_resp?.status_msg || bodyText}\` };
                    }
                    if (json?.status === "error") {
                        return { status: "failed", message: json?.base_resp?.status_msg || "MiniMax OAuth failed." };
                    }
                    if (json?.status !== "success") {
                        return { status: "pending" };
                    }
                    if (typeof json.access_token !== "string" || !json.access_token) {
                        return { status: "failed", message: "MiniMax OAuth returned an incomplete token payload." };
                    }
                    return {
                        status: "complete",
                        value: {
                            type: "oauth",
                            access: json.access_token,
                            refresh: json.refresh_token || "",
                            expires: _arcNormalizeExpiryMs(json.expired_in),
                            ...(json.resource_url ? { resourceUrl: json.resource_url } : {}),
                        },
                    };
                },
            });
        },
        refresh,
        async toAuth(credential) {
            const headers = { Authorization: \`Bearer \${credential.access}\` };
            if (typeof credential.resourceUrl === "string" && /^https:\\/\\//.test(credential.resourceUrl)) {
                return { baseUrl: credential.resourceUrl.replace(/\\/+$/, "") + "/anthropic", headers };
            }
            return { headers };
        },
    };
};
`;

const QWEN_PORTAL_MODELS_CODE = `[
    {
        id: "coder-model",
        name: "Qwen Coder (OAuth)",
        api: "openai-completions",
        provider: "qwen-portal",
        baseUrl: "https://portal.qwen.ai/v1",
        compat: { supportsStrictMode: true, thinkingFormat: "qwen", supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: true },
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 65536,
        type: "chat",
    },
    {
        id: "vision-model",
        name: "Qwen Vision (OAuth)",
        api: "openai-completions",
        provider: "qwen-portal",
        baseUrl: "https://portal.qwen.ai/v1",
        compat: { supportsStrictMode: true, supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false },
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
        type: "chat",
    },
    {
        id: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus (OAuth)",
        api: "openai-completions",
        provider: "qwen-portal",
        baseUrl: "https://portal.qwen.ai/v1",
        compat: { supportsStrictMode: true, thinkingFormat: "qwen", supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: true },
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 65536,
        type: "chat",
    },
]`;

export function applyOAuthPatches({ text, put, must, report }) {
  // 1a. Add Google, Qwen, MiniMax OAuth loaders to pi-ai/dist/auth/oauth/load.js
  {
    const p = PI + 'dist/auth/oauth/load.js';
    let s = text(p);
    s = replaceOnce(s, '//# sourceMappingURL=load.js.map', PI_AI_EXTRA_OAUTH + '\n//# sourceMappingURL=load.js.map', 'pi-ai oauth/load.js extra flows');
    put(p, s);
  }

  // 1b. Attach OAuth to Google & Google Vertex providers
  {
    const p = PI + 'dist/providers/google.js';
    let s = text(p);
    s = replaceOnce(s, 'import { envApiKeyAuth } from "../auth/helpers.js";', 'import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.js";\nimport { loadGoogleOAuth } from "../auth/oauth/load.js";', 'google.js imports');
    s = replaceOnce(
      s,
      'auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]) },',
      `auth: {\n            apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]),\n            oauth: lazyOAuth({\n                name: "Google Gemini (OAuth / ADC)",\n                isSubscription: false,\n                loginLabel: "Sign in with Google",\n                load: () => loadGoogleOAuth("google"),\n            }),\n        },`,
      'google.js oauth auth',
    );
    put(p, s);
  }
  {
    const p = PI + 'dist/providers/google-vertex.js';
    let s = text(p);
    s = replaceOnce(s, 'import { createProvider } from "../models.js";', 'import { lazyOAuth } from "../auth/helpers.js";\nimport { loadGoogleOAuth } from "../auth/oauth/load.js";\nimport { createProvider } from "../models.js";', 'google-vertex.js imports');
    s = replaceOnce(
      s,
      'auth: { apiKey: vertexAuth },',
      `auth: {\n            apiKey: vertexAuth,\n            oauth: lazyOAuth({\n                name: "Google Cloud Vertex AI (OAuth / ADC)",\n                isSubscription: false,\n                loginLabel: "Sign in with Google Cloud",\n                load: () => loadGoogleOAuth("google-vertex"),\n            }),\n        },`,
      'google-vertex.js oauth auth',
    );
    put(p, s);
  }

  // 1c. Patch google-generative-ai.js and google-vertex.js to support Bearer OAuth tokens via google-auth-library OAuth2Client
  {
    const p = PI + 'dist/api/google-generative-ai.js';
    let s = text(p);
    s = replaceOnce(s, 'import { GoogleGenAI, } from "@google/genai";', 'import { GoogleGenAI, } from "@google/genai";\nimport { OAuth2Client } from "google-auth-library";', 'google-generative-ai.js OAuth2Client import');
    s = replaceOnce(
      s,
      `            const apiKey = options?.apiKey;\n            if (!apiKey) {\n                throw new Error(\`No API key for provider: \${model.provider}\`);\n            }`,
      `            const apiKey = options?.apiKey;\n            const bearer = _arcBearerToken(options?.headers);\n            if (!apiKey && !bearer) {\n                throw new Error(\`No API key for provider: \${model.provider}\`);\n            }`,
      'google-generative-ai.js stream bearer check',
    );
    s = replaceOnce(
      s,
      `export const streamSimple = (model, context, options) => {\n    const apiKey = options?.apiKey;\n    if (!apiKey) {\n        throw new Error(\`No API key for provider: \${model.provider}\`);\n    }`,
      `export const streamSimple = (model, context, options) => {\n    const apiKey = options?.apiKey;\n    if (!apiKey && !_arcBearerToken(options?.headers)) {\n        throw new Error(\`No API key for provider: \${model.provider}\`);\n    }`,
      'google-generative-ai.js streamSimple bearer check',
    );
    s = replaceOnce(
      s,
      `function createClient(model, apiKey, optionsHeaders) {\n    const httpOptions = {};\n    if (model.baseUrl) {\n        httpOptions.baseUrl = model.baseUrl;\n        httpOptions.apiVersion = ""; // baseUrl already includes version path, don't append\n    }\n    const headers = providerHeadersToRecord({ "User-Agent": getPiUserAgent(), ...model.headers, ...optionsHeaders });\n    if (headers) {\n        httpOptions.headers = headers;\n    }\n    return new GoogleGenAI({\n        apiKey,\n        httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,\n    });\n}`,
      `function _arcBearerToken(headers) {\n    if (!headers) return undefined;\n    for (const [k, v] of Object.entries(headers)) {\n        if (k.toLowerCase() === "authorization" && typeof v === "string" && /^Bearer\\s+/i.test(v)) return v.replace(/^Bearer\\s+/i, "").trim();\n    }\n    return undefined;\n}\nfunction createClient(model, apiKey, optionsHeaders) {\n    const httpOptions = {};\n    if (model.baseUrl) {\n        httpOptions.baseUrl = model.baseUrl;\n        httpOptions.apiVersion = ""; // baseUrl already includes version path, don't append\n    }\n    const headers = providerHeadersToRecord({ "User-Agent": getPiUserAgent(), ...model.headers, ...optionsHeaders });\n    if (headers) {\n        httpOptions.headers = headers;\n    }\n    const bearer = _arcBearerToken(optionsHeaders);\n    if (!apiKey && bearer) {\n        const authClient = new OAuth2Client();\n        authClient.setCredentials({ access_token: bearer, expiry_date: Date.now() + 3600_000 });\n        return new GoogleGenAI({\n            googleAuthOptions: { authClient },\n            httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,\n        });\n    }\n    return new GoogleGenAI({\n        apiKey,\n        httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,\n    });\n}`,
      'google-generative-ai.js createClient OAuth2Client',
    );
    put(p, s);
  }
  {
    const p = PI + 'dist/api/google-vertex.js';
    let s = text(p);
    s = replaceOnce(s, 'import { GoogleGenAI, ResourceScope, } from "@google/genai";', 'import { GoogleGenAI, ResourceScope, } from "@google/genai";\nimport { OAuth2Client } from "google-auth-library";', 'google-vertex.js OAuth2Client import');
    s = replaceOnce(
      s,
      `function createClient(model, project, location, optionsHeaders, env) {\n    const googleAuthOptions = buildGoogleAuthOptions(env);`,
      `function _arcVertexBearer(headers) {\n    if (!headers) return undefined;\n    for (const [k, v] of Object.entries(headers)) {\n        if (k.toLowerCase() === "authorization" && typeof v === "string" && /^Bearer\\s+/i.test(v)) return v.replace(/^Bearer\\s+/i, "").trim();\n    }\n    return undefined;\n}\nfunction createClient(model, project, location, optionsHeaders, env) {\n    const bearer = _arcVertexBearer(optionsHeaders);\n    let googleAuthOptions;\n    if (bearer) {\n        const authClient = new OAuth2Client();\n        authClient.setCredentials({ access_token: bearer, expiry_date: Date.now() + 3600_000 });\n        googleAuthOptions = { authClient };\n    } else {\n        googleAuthOptions = buildGoogleAuthOptions(env);\n    }`,
      'google-vertex.js createClient OAuth2Client',
    );
    put(p, s);
  }

  // 1d. Attach OAuth to Chinese providers: Qwen (qwen-portal + qwen-token-plan*) and MiniMax (minimax + minimax-cn)
  for (const [file, constName] of [
    ['dist/providers/qwen-token-plan.js', 'QWEN_TOKEN_PLAN_MODELS'],
    ['dist/providers/qwen-token-plan-cn.js', 'QWEN_TOKEN_PLAN_CN_MODELS'],
    ['dist/providers/qwen-token-plan-individual.js', 'QWEN_TOKEN_PLAN_INDIVIDUAL_MODELS'],
  ]) {
    const p = PI + file;
    let s = text(p);
    s = replaceOnce(s, 'import { envApiKeyAuth } from "../auth/helpers.js";', 'import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.js";\nimport { loadQwenOAuth } from "../auth/oauth/load.js";', `${file} imports`);
    s = replaceOnce(
      s,
      /auth: \{ apiKey: envApiKeyAuth\(([^)]+)\) \},/,
      `auth: {\n            apiKey: envApiKeyAuth($1),\n            oauth: lazyOAuth({\n                name: "Qwen (OAuth)",\n                isSubscription: true,\n                loginLabel: "Sign in with Qwen",\n                load: loadQwenOAuth,\n            }),\n        },`,
      `${file} oauth auth`,
    );
    put(p, s);
  }

  for (const [file, region, label] of [
    ['dist/providers/minimax.js', 'global', 'MiniMax (OAuth)'],
    ['dist/providers/minimax-cn.js', 'cn', 'MiniMax CN (OAuth)'],
  ]) {
    const p = PI + file;
    let s = text(p);
    s = replaceOnce(s, 'import { envApiKeyAuth } from "../auth/helpers.js";', 'import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.js";\nimport { loadMiniMaxOAuth } from "../auth/oauth/load.js";', `${file} imports`);
    s = replaceOnce(
      s,
      /auth: \{ apiKey: envApiKeyAuth\(([^)]+)\) \},/,
      `auth: {\n            apiKey: envApiKeyAuth($1),\n            oauth: lazyOAuth({\n                name: ${JSON.stringify(label)},\n                isSubscription: true,\n                loginLabel: ${JSON.stringify('Sign in with ' + (region === 'cn' ? 'MiniMax CN' : 'MiniMax'))},\n                load: () => loadMiniMaxOAuth(${JSON.stringify(region)}),\n            }),\n        },`,
      `${file} oauth auth`,
    );
    put(p, s);
  }

  // 1e. Register qwen-portal built-in provider & models in pi-ai/dist/providers/all.js + models.generated.js
  {
    const p = PI + 'dist/models.generated.js';
    let s = text(p);
    const qwenModelsObj = `{ "coder-model": ${QWEN_PORTAL_MODELS_CODE.replace(/^\[|\s*\]$/g, '').trim().replace(/^\{/, '').length ? '' : ''}`
      + ` }`;
    void qwenModelsObj;
    const qpMap = `const QWEN_PORTAL_MODELS = Object.fromEntries(${QWEN_PORTAL_MODELS_CODE}.map((m) => [m.id, m]));`;
    s = replaceOnce(
      s,
      '    "qwen-token-plan": QWEN_TOKEN_PLAN_MODELS,',
      `    "qwen-portal": QWEN_PORTAL_MODELS,\n    "qwen-token-plan": QWEN_TOKEN_PLAN_MODELS,`,
      'models.generated.js MODELS qwen-portal',
    );
    s = replaceOnce(
      s,
      '    "qwen-token-plan": QWEN_TOKEN_PLAN_IMAGE_MODELS,',
      `    "qwen-portal": {},\n    "qwen-token-plan": QWEN_TOKEN_PLAN_IMAGE_MODELS,`,
      'models.generated.js IMAGE_MODELS qwen-portal',
    );
    s = replaceOnce(
      s,
      '    "qwen-token-plan": QWEN_TOKEN_PLAN_CLASSIFIER_MODELS,',
      `    "qwen-portal": {},\n    "qwen-token-plan": QWEN_TOKEN_PLAN_CLASSIFIER_MODELS,`,
      'models.generated.js CLASSIFIER_MODELS qwen-portal',
    );
    s = replaceOnce(
      s,
      'export const MODELS = {',
      `${qpMap}\nexport const MODELS = {`,
      'models.generated.js QWEN_PORTAL_MODELS def',
    );
    put(p, s);
  }
  {
    const p = PI + 'dist/providers/all.js';
    let s = text(p);
    s = replaceOnce(
      s,
      'import { createModels } from "../models.js";',
      `import { createModels, createProvider } from "../models.js";\nimport { openAICompletionsApi } from "../api/openai-completions.lazy.js";\nimport { lazyOAuth } from "../auth/helpers.js";\nimport { loadQwenOAuth } from "../auth/oauth/load.js";\nfunction qwenPortalProvider() {\n    return createProvider({\n        id: "qwen-portal",\n        name: "Qwen Portal (OAuth)",\n        baseUrl: "https://portal.qwen.ai/v1",\n        auth: {\n            oauth: lazyOAuth({\n                name: "Qwen (OAuth)",\n                isSubscription: true,\n                loginLabel: "Sign in with Qwen",\n                load: loadQwenOAuth,\n            }),\n        },\n        models: ${QWEN_PORTAL_MODELS_CODE},\n        api: openAICompletionsApi(),\n    });\n}`,
      'providers/all.js qwenPortalProvider def',
    );
    s = replaceOnce(
      s,
      '        qwenTokenPlanProvider(),',
      '        qwenPortalProvider(),\n        qwenTokenPlanProvider(),',
      'providers/all.js register qwenPortalProvider',
    );
    put(p, s);
  }

  // ---------------------------------------------------------------------------
  // 2. dsh-llm-pi-ai: enable OpenAI OAuth, persist device ID, resolveApiKey OAuth fallback, qwen-portal metadata
  // ---------------------------------------------------------------------------
  {
    const p = DS + 'dsh-llm-pi-ai/lib/index.js';
    let s = text(p);
    s = replaceOnce(
      s,
      'import { access } from "node:fs/promises";',
      'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";\nimport { randomUUID } from "node:crypto";\nimport { access } from "node:fs/promises";\nimport { resolveDshHome } from "@deepseek-ai/dsh-home-paths";',
      'dsh-llm-pi-ai imports for device id',
    );
    s = replaceOnce(
      s,
      'const UNSERVED_OAUTH = new Set(["openai"]);',
      `const UNSERVED_OAUTH = new Set();\nfunction ensureInstallDeviceId() {\n\tconst dir = resolveDshHome();\n\tconst file = resolve(dir, ".oauth-device-id");\n\ttry {\n\t\tconst existing = readFileSync(file, "utf8").trim();\n\t\tif (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) return existing;\n\t} catch {}\n\tconst id = randomUUID();\n\ttry {\n\t\tmkdirSync(dir, { recursive: true, mode: 448 });\n\t\twriteFileSync(file, id + "\\n", { mode: 384 });\n\t} catch {}\n\treturn id;\n}`,
      'dsh-llm-pi-ai UNSERVED_OAUTH + ensureInstallDeviceId',
    );
    s = replaceOnce(
      s,
      `\t\t\t\tawait models.login(providerId, type, {\n\t\t\t\t\tsignal: session.signal,\n\t\t\t\t\tnotify: (event) => {\n\t\t\t\t\t\trelay(event, session);\n\t\t\t\t\t},\n\t\t\t\t\tprompt: (prompt) => session.prompt(restate(prompt))\n\t\t\t\t});`,
      `\t\t\t\tawait models.login(providerId, type, {\n\t\t\t\t\tsignal: session.signal,\n\t\t\t\t\tnotify: (event) => {\n\t\t\t\t\t\trelay(event, session);\n\t\t\t\t\t},\n\t\t\t\t\tprompt: (prompt) => session.prompt(restate(prompt))\n\t\t\t\t}, providerId === "openai" ? { getDeviceId: ensureInstallDeviceId, agentName: "Arc Harness" } : void 0);`,
      'dsh-llm-pi-ai models.login deviceId option',
    );
    s = replaceOnce(
      s,
      `\t"qwen-token-plan": {`,
      `\t"qwen-portal": {\n\t\tenv: [],\n\t\tdefaultBaseURL: "https://portal.qwen.ai/v1"\n\t},\n\t"qwen-token-plan": {`,
      'dsh-llm-pi-ai PROVIDER_DATA qwen-portal',
    );
    s = replaceOnce(
      s,
      `\tconst resolveApiKey = async (provider, profile) => {\n\t\tconst ref = profile.apiKeyEnv;\n\t\tif (ref === void 0) return void 0;\n\t\tconst credentials = ctx.get("credentials");\n\t\tconst hit = credentials !== void 0 ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;\n\t\tif (hit !== void 0 && hit.length > 0) return assertUsableApiKey(hit, "llm-pi-ai", ref);\n\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");\n\t};`,
      `\tconst resolveApiKey = async (provider, profile) => {\n\t\tconst ref = profile.apiKeyEnv;\n\t\tif (ref === void 0) return void 0;\n\t\tconst credentials = ctx.get("credentials");\n\t\tconst hit = credentials !== void 0 ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;\n\t\tif (hit !== void 0 && hit.length > 0) return assertUsableApiKey(hit, "llm-pi-ai", ref);\n\t\tif (credentials !== void 0 && isCredentialKeySegment(provider)) {\n\t\t\tconst record = await credentials.readRecord(recordKeyFor(provider));\n\t\t\tif (record?.kind === "grant") return void 0;\n\t\t}\n\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");\n\t};`,
      'dsh-llm-pi-ai resolveApiKey OAuth record fallback',
    );
    put(p, s);
  }

  // ---------------------------------------------------------------------------
  // 3. dsh-api-settings-controller: expose OAuth authorization RPCs on CredentialsController
  // ---------------------------------------------------------------------------
  {
    const p = DS + 'dsh-api-settings-controller/lib/index.js';
    let s = text(p);
    s = replaceOnce(
      s,
      'import { credentialRef } from "@deepseek-ai/dsh-credentials";',
      'import { randomUUID } from "node:crypto";\nimport { AuthorizationDeclinedError } from "@deepseek-ai/dsh-authorization";\nimport { credentialRef, parseCredentialKey } from "@deepseek-ai/dsh-credentials";',
      'settings-controller imports',
    );
    s = replaceOnce(
      s,
      `let _describe_decorators;\n\tlet _set_decorators;\n\tlet _unset_decorators;`,
      `let _describe_decorators;\n\tlet _set_decorators;\n\tlet _unset_decorators;\n\tlet _oauthList_decorators;\n\tlet _oauthStart_decorators;\n\tlet _oauthPoll_decorators;\n\tlet _oauthAnswer_decorators;\n\tlet _oauthCancel_decorators;\n\tlet _oauthLogout_decorators;`,
      'CredentialsController decorator vars',
    );
    s = replaceOnce(
      s,
      `\t\t\t_describe_decorators = [Remote];\n\t\t\t_set_decorators = [Remote];\n\t\t\t_unset_decorators = [Remote];`,
      `\t\t\t_describe_decorators = [Remote];\n\t\t\t_set_decorators = [Remote];\n\t\t\t_unset_decorators = [Remote];\n\t\t\t_oauthList_decorators = [Remote];\n\t\t\t_oauthStart_decorators = [Remote];\n\t\t\t_oauthPoll_decorators = [Remote];\n\t\t\t_oauthAnswer_decorators = [Remote];\n\t\t\t_oauthCancel_decorators = [Remote];\n\t\t\t_oauthLogout_decorators = [Remote];`,
      'CredentialsController decorator assigns',
    );
    const extraDecorate = ['oauthList', 'oauthStart', 'oauthPoll', 'oauthAnswer', 'oauthCancel', 'oauthLogout'].map((m) => `\t\t\t__esDecorate$1(this, null, _${m}_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "${m}",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "${m}" in obj,\n\t\t\t\t\tget: (obj) => obj.${m}\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);`).join('\n');
    const unsetAnchor = `\t\t\t__esDecorate$1(this, null, _unset_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "unset",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "unset" in obj,\n\t\t\t\t\tget: (obj) => obj.unset\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);`;
    s = replaceOnce(
      s,
      unsetAnchor,
      `${unsetAnchor}\n${extraDecorate}`,
      'CredentialsController __esDecorate$1 calls',
    );
    s = replaceOnce(
      s,
      `\t\tconstructor(ctx) {\n\t\t\tsuper(ctx, "credentialsController", { namespace: "credentials" });\n\t\t\t__runInitializers$1(this, _instanceExtraInitializers);\n\t\t}`,
      `\t\toauthAttempts = new Map();\n\t\tconstructor(ctx) {\n\t\t\tsuper(ctx, "credentialsController", { namespace: "credentials" });\n\t\t\t__runInitializers$1(this, _instanceExtraInitializers);\n\t\t}`,
      'CredentialsController oauthAttempts field',
    );

    const oauthMethods = `
		authorizationService() {
			const auth = this.ctx.get("authorization");
			if (auth === void 0) throw new RemoteError("gateway/internal", "authorization service is absent in this deployment", {});
			return auth;
		}
		projectAttempt(attempt) {
			return {
				attemptId: attempt.id,
				key: attempt.key,
				method: attempt.method,
				status: attempt.status,
				notices: attempt.notices.map((n) => ({ ...n })),
				pendingPrompt: attempt.pendingPrompt === null ? null : { ...attempt.pendingPrompt },
				...(attempt.error === void 0 ? {} : { error: attempt.error }),
			};
		}
		pruneAttempts() {
			if (this.oauthAttempts.size <= 32) return;
			for (const [id, entry] of this.oauthAttempts) {
				if (entry.status !== "running") this.oauthAttempts.delete(id);
				if (this.oauthAttempts.size <= 24) break;
			}
		}
		async oauthList() {
			const auth = this.ctx.get("authorization");
			if (auth === void 0) return { flows: [] };
			const credentials = this.ctx.get("credentials");
			const entries = auth.list();
			const flows = await Promise.all(entries.map(async (entry) => {
				const info = credentials !== void 0 ? await credentials.describeRecord(entry.key) : { configured: false, writable: false };
				const slash = entry.key.indexOf("/");
				return {
					key: entry.key,
					provider: slash >= 0 ? entry.key.slice(slash + 1) : entry.key,
					label: entry.label,
					methods: entry.methods,
					inFlight: entry.inFlight,
					configured: info.configured,
					...(info.kind === void 0 ? {} : { kind: info.kind }),
					writable: info.writable,
				};
			}));
			return { flows };
		}
		async oauthStart(key, method) {
			if (typeof key !== "string" || key.length === 0) throw new RemoteError("gateway/bad-request", "invalid oauth key", {});
			const auth = this.authorizationService();
			const flow = auth.describe(key);
			if (flow === void 0) throw new RemoteError("gateway/bad-request", \`no authorization flow for "\${key}"\`, {});
			if (flow.inFlight) throw new RemoteError("gateway/conflict", \`an authorization attempt for "\${key}" is already running\`, {});
			const chosenMethod = typeof method === "string" && method.length > 0 ? method : flow.methods[0]?.id ?? "oauth";
			if (!flow.methods.some((m) => m.id === chosenMethod)) throw new RemoteError("gateway/bad-request", \`unknown authorization method "\${chosenMethod}"\`, {});
			this.pruneAttempts();
			const attemptId = randomUUID();
			const attempt = {
				id: attemptId,
				key,
				method: chosenMethod,
				status: "running",
				notices: [],
				pendingPrompt: null,
				error: void 0,
				controller: new AbortController(),
				resolvePrompt: null,
				rejectPrompt: null,
			};
			this.oauthAttempts.set(attemptId, attempt);
			const settlePending = (err) => {
				if (attempt.rejectPrompt) {
					const rej = attempt.rejectPrompt;
					attempt.resolvePrompt = null;
					attempt.rejectPrompt = null;
					attempt.pendingPrompt = null;
					rej(err);
				}
			};
			void auth.begin({
				key,
				method: chosenMethod,
				signal: attempt.controller.signal,
				interaction: {
					notify: (notice) => {
						attempt.notices.push({
							message: notice.message,
							...(notice.url === void 0 ? {} : { url: notice.url }),
							...(notice.code === void 0 ? {} : { code: notice.code }),
						});
						if (attempt.notices.length > 10) attempt.notices.shift();
					},
					prompt: (prompt) => {
						if (prompt.signal?.aborted) return Promise.reject(new Error("prompt aborted"));
						const promptId = randomUUID();
						return new Promise((resolve, reject) => {
							const onAbort = () => {
								if (attempt.pendingPrompt?.id === promptId) {
									attempt.pendingPrompt = null;
									attempt.resolvePrompt = null;
									attempt.rejectPrompt = null;
								}
								reject(new Error("prompt aborted"));
							};
							prompt.signal?.addEventListener("abort", onAbort, { once: true });
							attempt.pendingPrompt = {
								id: promptId,
								kind: prompt.kind,
								message: prompt.message,
								...(prompt.placeholder === void 0 ? {} : { placeholder: prompt.placeholder }),
								...(prompt.options === void 0 ? {} : { options: prompt.options }),
							};
							attempt.resolvePrompt = (val) => {
								prompt.signal?.removeEventListener("abort", onAbort);
								resolve(val);
							};
							attempt.rejectPrompt = (err) => {
								prompt.signal?.removeEventListener("abort", onAbort);
								reject(err);
							};
						});
					},
				},
			}).then((outcome) => {
				settlePending(new Error("authorization settled"));
				attempt.status = outcome.status;
			}, (error) => {
				settlePending(new Error("authorization failed"));
				attempt.status = "failed";
				attempt.error = messageOf(error);
			});
			return this.projectAttempt(attempt);
		}
		async oauthPoll(attemptId) {
			const attempt = this.oauthAttempts.get(attemptId);
			if (attempt === void 0) throw new RemoteError("gateway/not-found", \`unknown oauth attempt "\${attemptId}"\`, {});
			return this.projectAttempt(attempt);
		}
		async oauthAnswer(attemptId, promptId, answer, decline) {
			const attempt = this.oauthAttempts.get(attemptId);
			if (attempt === void 0) throw new RemoteError("gateway/not-found", \`unknown oauth attempt "\${attemptId}"\`, {});
			if (attempt.pendingPrompt?.id !== promptId) return { accepted: false };
			const resolve = attempt.resolvePrompt;
			const reject = attempt.rejectPrompt;
			attempt.pendingPrompt = null;
			attempt.resolvePrompt = null;
			attempt.rejectPrompt = null;
			if (decline === true) reject?.(new AuthorizationDeclinedError("cancelled by user"));
			else resolve?.(typeof answer === "string" ? answer : "");
			return { accepted: true };
		}
		async oauthCancel(attemptId) {
			const attempt = this.oauthAttempts.get(attemptId);
			if (attempt === void 0) return { cancelled: true };
			attempt.controller.abort();
			this.ctx.get("authorization")?.cancel(attempt.key);
			if (attempt.rejectPrompt) {
				const rej = attempt.rejectPrompt;
				attempt.pendingPrompt = null;
				attempt.resolvePrompt = null;
				attempt.rejectPrompt = null;
				rej(new AuthorizationDeclinedError("cancelled by user"));
			}
			if (attempt.status === "running") attempt.status = "cancelled";
			return { cancelled: true };
		}
		async oauthLogout(key) {
			if (typeof key !== "string" || key.length === 0) throw new RemoteError("gateway/bad-request", "invalid oauth key", {});
			const parsed = parseCredentialKey(key);
			this.ctx.get("authorization")?.cancel(parsed);
			for (const attempt of this.oauthAttempts.values()) {
				if (attempt.key === parsed && attempt.status === "running") {
					attempt.controller.abort();
					attempt.status = "cancelled";
				}
			}
			await this.write(parsed, () => this.provider().deleteRecord(parsed));
			return { cleared: true };
		}`;

    s = replaceOnce(
      s,
      `\t\tasync unset(ref) {`,
      `${oauthMethods}\n\t\tasync unset(ref) {`,
      'CredentialsController add OAuth methods',
    );
    put(p, s);
  }

  // 3b. Add Typert schemas and descriptors to dsh-api-settings-controller/lib/typert.host.js, typert.remote-client.js, and dsh-api-remotes/lib/client.js
  const makeTypertDefs = (Z) => `
const _arcOauthListResult = () => ${Z}.object({
  flows: ${Z}.array(${Z}.object({
    key: ${Z}.string(),
    provider: ${Z}.string(),
    label: ${Z}.string(),
    methods: ${Z}.array(${Z}.object({ id: ${Z}.string(), label: ${Z}.string() })),
    inFlight: ${Z}.boolean(),
    configured: ${Z}.boolean(),
    kind: ${Z}.string().optional(),
    writable: ${Z}.boolean(),
  })),
});
const _arcOauthState = () => ${Z}.object({
  attemptId: ${Z}.string(),
  key: ${Z}.string(),
  method: ${Z}.string(),
  status: ${Z}.string(),
  notices: ${Z}.array(${Z}.object({
    message: ${Z}.string(),
    url: ${Z}.string().optional(),
    code: ${Z}.string().optional(),
  })),
  pendingPrompt: ${Z}.union([${Z}.null(), ${Z}.object({
    id: ${Z}.string(),
    kind: ${Z}.string(),
    message: ${Z}.string(),
    placeholder: ${Z}.string().optional(),
    options: ${Z}.array(${Z}.object({ id: ${Z}.string(), label: ${Z}.string() })).optional(),
  })]),
  error: ${Z}.string().optional(),
});
const _arcStr = () => ${Z}.string();
const _arcOptStr = () => ${Z}.union([${Z}.undefined(), ${Z}.string()]);
const _arcOptBool = () => ${Z}.union([${Z}.undefined(), ${Z}.boolean()]);
const _arcAccepted = () => ${Z}.object({ accepted: ${Z}.boolean() });
const _arcCancelled = () => ${Z}.object({ cancelled: ${Z}.boolean() });
const _arcCleared = () => ${Z}.object({ cleared: ${Z}.boolean() });
`;
  const typertRemoteMethods = `
    "credentials/oauthList": {
      service: "credentialsController",
      description: "List registered authorization flows and their record status.",
      invocation: { kind: "direct" },
      parameters: [],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthList:result", create: _arcOauthListResult },
    },
    "credentials/oauthStart": {
      service: "credentialsController",
      description: "Start an authorization flow attempt.",
      invocation: { kind: "direct" },
      parameters: [
        { name: "key", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthStart:key", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthStart:key", create: _arcStr } },
        { name: "method", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthStart:method", create: _arcOptStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthStart:method", create: _arcOptStr } },
      ],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthStart:result", create: _arcOauthState },
    },
    "credentials/oauthPoll": {
      service: "credentialsController",
      description: "Poll the current state of an authorization attempt.",
      invocation: { kind: "direct" },
      parameters: [
        { name: "attemptId", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthPoll:attemptId", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthPoll:attemptId", create: _arcStr } },
      ],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthPoll:result", create: _arcOauthState },
    },
    "credentials/oauthAnswer": {
      service: "credentialsController",
      description: "Answer or decline a pending authorization prompt.",
      invocation: { kind: "direct" },
      parameters: [
        { name: "attemptId", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:attemptId", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:attemptId", create: _arcStr } },
        { name: "promptId", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:promptId", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:promptId", create: _arcStr } },
        { name: "answer", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:answer", create: _arcOptStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:answer", create: _arcOptStr } },
        { name: "decline", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:decline", create: _arcOptBool }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:decline", create: _arcOptBool } },
      ],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthAnswer:result", create: _arcAccepted },
    },
    "credentials/oauthCancel": {
      service: "credentialsController",
      description: "Cancel a running authorization attempt.",
      invocation: { kind: "direct" },
      parameters: [
        { name: "attemptId", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthCancel:attemptId", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthCancel:attemptId", create: _arcStr } },
      ],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthCancel:result", create: _arcCancelled },
    },
    "credentials/oauthLogout": {
      service: "credentialsController",
      description: "Delete a stored credential record for an authorization key.",
      invocation: { kind: "direct" },
      parameters: [
        { name: "key", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthLogout:key", create: _arcStr }, strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthLogout:key", create: _arcStr } },
      ],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/oauthLogout:result", create: _arcCleared },
    },`;

  for (const [rel, zExpr, defsAnchor, methodAnchor] of [
    ['dsh-api-settings-controller/lib/typert.host.js', 'z', 'const $remote = createTypertRemoteInfo({', "    'credentials/describe': {"],
    ['dsh-api-settings-controller/lib/typert.remote-client.js', 'z', 'export const TYPERT_REMOTE = createTypertRemoteInfo({', "    'credentials/describe': {"],
    ['dsh-api-remotes/lib/client.js', 'zod.z', '\t\tconst TYPERT_REMOTE$20 = createTypertRemoteInfo({', '\t\t\t\t"credentials/describe": {'],
  ]) {
    const p = DS + rel;
    let s = text(p);
    s = replaceOnce(s, defsAnchor, `${makeTypertDefs(zExpr)}\n${defsAnchor}`, `${rel} schemas`);
    s = replaceOnce(s, methodAnchor, `${typertRemoteMethods}\n${methodAnchor}`, `${rel} methods`);
    put(p, s);
  }

  // ---------------------------------------------------------------------------
  // 4. dsh-client-ui-settings-models: OAuth UI, store state, operations, locales, C2 CSS
  // ---------------------------------------------------------------------------
  {
    const p = DS + 'dsh-client-ui-settings-models/lib/client.js';
    let s = text(p);

    // 4a. Extra CSS using theme CSS variables only (zero hardcoded hex, zero blue)
    const oauthCss = '.jrmgQW_oauthBox{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:10px;padding:12px;display:flex}.jrmgQW_oauthHead{align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;display:flex}.jrmgQW_oauthMeta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.jrmgQW_oauthActions{align-items:center;gap:8px;flex-wrap:wrap;display:flex}.jrmgQW_oauthCodeBox{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;display:flex}.jrmgQW_oauthCode{font-family:var(--ds-font-family-code);font-size:15px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-label-primary)}.jrmgQW_oauthLink{color:var(--dsw-alias-label-primary);text-decoration:underline;font-size:12px;line-height:18px;word-break:break-all}.jrmgQW_oauthPrompt{flex-direction:column;gap:8px;display:flex}.jrmgQW_oauthOptions{flex-wrap:wrap;gap:8px;display:flex}';
    s = replaceOnce(s, '.jrmgQW_candidateEmpty{', oauthCss + '.jrmgQW_candidateEmpty{', 'ui-settings-models oauth css');
    s = replaceOnce(
      s,
      '"accountStatus": "jrmgQW_accountStatus",',
      '"accountStatus": "jrmgQW_accountStatus",\n\t\t\t"oauthBox": "jrmgQW_oauthBox",\n\t\t\t"oauthHead": "jrmgQW_oauthHead",\n\t\t\t"oauthMeta": "jrmgQW_oauthMeta",\n\t\t\t"oauthActions": "jrmgQW_oauthActions",\n\t\t\t"oauthCodeBox": "jrmgQW_oauthCodeBox",\n\t\t\t"oauthCode": "jrmgQW_oauthCode",\n\t\t\t"oauthLink": "jrmgQW_oauthLink",\n\t\t\t"oauthPrompt": "jrmgQW_oauthPrompt",\n\t\t\t"oauthOptions": "jrmgQW_oauthOptions",',
      'ui-settings-models css map',
    );

    // 4b. Operations: wire oauthList, oauthStart, oauthPoll, oauthAnswer, oauthCancel, oauthLogout
    s = replaceOnce(
      s,
      `storeCredential: async (ref, value) => {`,
      `oauthList: async () => {\n\t\t\t\t\tconst response = await ctx.remote.credentials.oauthList();\n\t\t\t\t\treturn response.ok ? response.value.flows : [];\n\t\t\t\t},\n\t\t\t\toauthStart: async (key, method) => {\n\t\t\t\t\tconst response = await ctx.remote.credentials.oauthStart(key, method);\n\t\t\t\t\treturn response.ok ? { ok: true, state: response.value } : { ok: false, message: response.error.message };\n\t\t\t\t},\n\t\t\t\toauthPoll: async (attemptId) => {\n\t\t\t\t\tconst response = await ctx.remote.credentials.oauthPoll(attemptId);\n\t\t\t\t\treturn response.ok ? { ok: true, state: response.value } : { ok: false, message: response.error.message };\n\t\t\t\t},\n\t\t\t\toauthAnswer: async (attemptId, promptId, answer, decline) => {\n\t\t\t\t\tconst response = await ctx.remote.credentials.oauthAnswer(attemptId, promptId, answer, decline);\n\t\t\t\t\treturn response.ok ? void 0 : response.error.message;\n\t\t\t\t},\n\t\t\t\toauthCancel: async (attemptId) => {\n\t\t\t\t\tawait ctx.remote.credentials.oauthCancel(attemptId);\n\t\t\t\t},\n\t\t\t\toauthLogout: async (key) => {\n\t\t\t\t\tconst response = await ctx.remote.credentials.oauthLogout(key);\n\t\t\t\t\treturn response.ok ? void 0 : response.error.message;\n\t\t\t\t},\n\t\t\t\tstoreCredential: async (ref, value) => {`,
      'ui-settings-models createModelsOperations',
    );

    // 4c. ModelsSettingsStore: also fetch oauthList() and attach row.oauth; update providerUsable
    s = replaceOnce(
      s,
      `const [registered, declared] = await Promise.all([\n\t\t\t\t\tthis.ctx.remote.llm.listProviders(),\n\t\t\t\t\tthis.ctx.remote.llm.listConfigurableProviders(),\n\t\t\t\t\tthis.describeFace.ensure()\n\t\t\t\t]);`,
      `const [registered, declared, _desc, oauthRes] = await Promise.all([\n\t\t\t\t\tthis.ctx.remote.llm.listProviders(),\n\t\t\t\t\tthis.ctx.remote.llm.listConfigurableProviders(),\n\t\t\t\t\tthis.describeFace.ensure(),\n\t\t\t\t\tthis.ctx.remote.credentials.oauthList().catch(() => ({ ok: false }))\n\t\t\t\t]);\n\t\t\t\tconst oauthByProvider = new Map(oauthRes.ok ? oauthRes.value.flows.map((f) => [f.provider, f]) : []);`,
      'ui-settings-models store read oauthList',
    );
    s = replaceOnce(
      s,
      `...named === void 0 ? {} : { credential: named },`,
      `...oauthByProvider.has(row.entry.provider) ? { oauth: oauthByProvider.get(row.entry.provider) } : {},\n\t\t\t\t\t\t\t...named === void 0 ? {} : { credential: named },`,
      'ui-settings-models store attach row.oauth',
    );
    s = replaceOnce(
      s,
      `function providerUsable(row) {\n\t\t\tif (!row.entry.active) return false;\n\t\t\tif (row.entry.provider === "deepseek-account") return row.accountAvailable === true;\n\t\t\tif (row.apiKeyEnv === void 0) return true;\n\t\t\treturn row.credential?.configured === true;\n\t\t}`,
      `function providerUsable(row) {\n\t\t\tif (!row.entry.active) return false;\n\t\t\tif (row.entry.provider === "deepseek-account") return row.accountAvailable === true;\n\t\t\tif (row.oauth?.configured === true) return true;\n\t\t\tif (row.apiKeyEnv === void 0) {\n\t\t\t\tif (row.oauth && row.entry.nativeAuth?.env.length === 0) return false;\n\t\t\t\treturn true;\n\t\t\t}\n\t\t\treturn row.credential?.configured === true;\n\t\t}`,
      'ui-settings-models providerUsable',
    );

    // 4d. Pass row.oauth through renderProviderEditor and add-provider draft ProviderEditor
    s = replaceOnce(
      s,
      `...row.credentialChecks === void 0 ? {} : { credentialChecks: row.credentialChecks },`,
      `...row.credentialChecks === void 0 ? {} : { credentialChecks: row.credentialChecks },\n\t\t\t\t...row.oauth === void 0 ? {} : { oauth: row.oauth },`,
      'renderProviderEditor oauth prop',
    );
    s = replaceOnce(
      s,
      `...addRow?.credentialChecks === void 0 ? {} : { credentialChecks: addRow.credentialChecks },`,
      `...addRow?.credentialChecks === void 0 ? {} : { credentialChecks: addRow.credentialChecks },\n\t\t\t\t\t\t\t\t\t\t\t...addRow?.oauth === void 0 ? {} : { oauth: addRow.oauth },`,
      'addRow ProviderEditor oauth prop',
    );

    // 4e. OAuth interactive panel component right before ProviderEditor + render it inside curatedFields
    const oauthPanelCode = `
		function OAuthPanel({ provider, oauth, operations, t, disabled, onSignedIn, onSignedOut }) {
			const [attempt, setAttempt] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [inputValue, setInputValue] = (0, react.useState)("");
			const [copiedCode, setCopiedCode] = (0, react.useState)(false);
			const openedUrlRef = (0, react.useRef)(void 0);
			const oauthMethod = oauth?.methods?.find((m) => m.id === "oauth");
			const attemptId = attempt?.attemptId;
			const status = attempt?.status;
			(0, react.useEffect)(() => {
				if (!attemptId || status !== "running") return;
				let alive = true;
				const timer = setInterval(async () => {
					const res = await operations.oauthPoll(attemptId);
					if (!alive) return;
					if (!res.ok) {
						setError(res.message);
						setAttempt(void 0);
						return;
					}
					setAttempt(res.state);
					if (res.state.status === "authorized") {
						setAttempt(void 0);
						setInputValue("");
						onSignedIn?.();
					} else if (res.state.status === "failed") {
						setError(res.state.error ?? t("oauthFailed"));
						setAttempt(void 0);
					} else if (res.state.status === "cancelled") {
						setAttempt(void 0);
					}
				}, 400);
				return () => { alive = false; clearInterval(timer); };
			}, [attemptId, status, operations, onSignedIn, t]);
			const latestNotice = attempt?.notices?.length ? attempt.notices[attempt.notices.length - 1] : void 0;
			const noticeUrl = latestNotice?.url;
			(0, react.useEffect)(() => {
				if (noticeUrl && openedUrlRef.current !== noticeUrl) {
					openedUrlRef.current = noticeUrl;
					try { globalThis.open?.(noticeUrl, "_blank", "noopener,noreferrer"); } catch {}
				}
			}, [noticeUrl]);
			if (!oauthMethod) return null;
			const startLogin = async () => {
				setBusy(true);
				setError(void 0);
				setInputValue("");
				openedUrlRef.current = void 0;
				try {
					const res = await operations.oauthStart(oauth.key, "oauth");
					if (!res.ok) { setError(res.message); return; }
					setAttempt(res.state);
				} finally { setBusy(false); }
			};
			const logout = async () => {
				setBusy(true);
				setError(void 0);
				try {
					const msg = await operations.oauthLogout(oauth.key);
					if (msg !== void 0) { setError(msg); return; }
					onSignedOut?.();
				} finally { setBusy(false); }
			};
			const submitAnswer = async (val, decline = false) => {
				if (!attempt?.pendingPrompt) return;
				setBusy(true);
				setError(void 0);
				try {
					const msg = await operations.oauthAnswer(attempt.attemptId, attempt.pendingPrompt.id, val, decline);
					if (msg !== void 0) setError(msg);
					setInputValue("");
				} finally { setBusy(false); }
			};
			const cancelLogin = async () => {
				if (!attempt) return;
				await operations.oauthCancel(attempt.attemptId);
				setAttempt(void 0);
			};
			const copyCode = (code) => {
				try { globalThis.navigator?.clipboard?.writeText(code); setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); } catch {}
			};
			const pending = attempt?.pendingPrompt;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ModelsSection_module_css_default["oauthBox"],
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["oauthHead"],
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelsSection_module_css_default["fieldLabel"],
								children: oauth.configured ? t("oauthSignedIn") : t("oauthTitle")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: ModelsSection_module_css_default["oauthActions"],
								children: [
									oauth.configured ? (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelsSection_module_css_default["dangerButton"],
										disabled: disabled || busy || attempt?.status === "running",
										onClick: logout,
										children: t("oauthSignOut")
									}) : null,
									attempt?.status === "running" ? (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelsSection_module_css_default["secondaryButton"],
										disabled: busy,
										onClick: cancelLogin,
										children: t("cancel")
									}) : (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: oauth.configured ? ModelsSection_module_css_default["secondaryButton"] : ModelsSection_module_css_default["primaryButton"],
										disabled: disabled || busy || !oauth.writable,
										onClick: startLogin,
										children: oauth.configured ? t("oauthReconnect") : oauthMethod.label
									})
								]
							})
						]
					}),
					latestNotice ? (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["oauthMeta"], children: latestNotice.message }) : null,
					latestNotice?.code ? (0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["oauthCodeBox"],
						children: [
							(0, react_jsx_runtime.jsx)("code", { className: ModelsSection_module_css_default["oauthCode"], children: latestNotice.code }),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ModelsSection_module_css_default["secondaryButton"],
								onClick: () => copyCode(latestNotice.code),
								children: copiedCode ? t("oauthCopied") : t("oauthCopyCode")
							})
						]
					}) : null,
					latestNotice?.url ? (0, react_jsx_runtime.jsx)("a", {
						className: ModelsSection_module_css_default["oauthLink"],
						href: latestNotice.url,
						target: "_blank",
						rel: "noopener noreferrer",
						children: t("oauthOpenBrowser")
					}) : null,
					pending ? (0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["oauthPrompt"],
						children: [
							(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["oauthMeta"], children: pending.message }),
							pending.kind === "select" && Array.isArray(pending.options) ? (0, react_jsx_runtime.jsx)("div", {
								className: ModelsSection_module_css_default["oauthOptions"],
								children: pending.options.map((opt) => (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelsSection_module_css_default["secondaryButton"],
									disabled: busy,
									onClick: () => submitAnswer(opt.id, false),
									children: opt.label
								}, opt.id))
							}) : (0, react_jsx_runtime.jsxs)("div", {
								className: ModelsSection_module_css_default["oauthActions"],
								children: [
									(0, react_jsx_runtime.jsx)("input", {
										className: ModelsSection_module_css_default["input"],
										type: pending.kind === "secret" ? "password" : "text",
										value: inputValue,
										placeholder: pending.placeholder ?? "",
										"aria-label": pending.message,
										disabled: busy,
										onChange: (e) => setInputValue(e.target.value),
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelsSection_module_css_default["primaryButton"],
										disabled: busy,
										onClick: () => submitAnswer(inputValue, false),
										children: t("oauthSubmit")
									})
								]
							})
						]
					}) : null,
					error ? (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["error"], children: error }) : null
				]
			});
		}
`;
    s = replaceOnce(s, 'function ProviderEditor(props) {', oauthPanelCode + '\n\t\tfunction ProviderEditor(props) {', 'add OAuthPanel component');

    // Render OAuthPanel inside curatedFields and auto-materialize pi-ai profile when OAuth succeeds
    s = replaceOnce(
      s,
      `return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [keylessNativeAuth ? null : (0, react_jsx_runtime.jsxs)("div", {`,
      `const onOAuthSignedIn = async () => {\n\t\t\t\t\tif (family === "pi-ai" && fallback === void 0 && committedOriginal === void 0) {\n\t\t\t\t\t\tconst next = schema.deletePath(draft, ["apiKeyEnv"]);\n\t\t\t\t\t\tconst ops = Object.keys(next).length === 0 ? [{ op: "set", path: [...settingsPath], value: {} }] : pathOps(settingsPath, committedOriginal, next);\n\t\t\t\t\t\tawait operations.writeSettings(namespace.ns, ops, expectedRevision);\n\t\t\t\t\t}\n\t\t\t\t\tprops.onClose(true);\n\t\t\t\t};\n\t\t\t\tconst onOAuthSignedOut = () => { props.onClose(true); };\n\t\t\t\treturn (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [family === "pi-ai" && props.oauth !== void 0 ? (0, react_jsx_runtime.jsx)(OAuthPanel, {\n\t\t\t\t\tprovider: props.provider,\n\t\t\t\t\toauth: props.oauth,\n\t\t\t\t\toperations,\n\t\t\t\t\tt,\n\t\t\t\t\tdisabled,\n\t\t\t\t\tonSignedIn: onOAuthSignedIn,\n\t\t\t\t\tonSignedOut: onOAuthSignedOut,\n\t\t\t\t}) : null, keylessNativeAuth ? null : (0, react_jsx_runtime.jsxs)("div", {`,
      'render OAuthPanel in ProviderEditor',
    );

    // 4f. Show OAuth signed-in indicator in ModelsSection rowCard
    s = replaceOnce(
      s,
      `const credentialConfigured = row.credential?.configured === true;\n\t\t\t\t\t\t\tconst credentialMissing = !credentialConfigured && row.apiKeyEnv !== void 0 && row.credential?.configured === false;`,
      `const oauthConfigured = row.oauth?.configured === true;\n\t\t\t\t\t\t\tconst credentialConfigured = row.credential?.configured === true;\n\t\t\t\t\t\t\tconst credentialMissing = !oauthConfigured && !credentialConfigured && row.apiKeyEnv !== void 0 && row.credential?.configured === false;`,
      'ModelsSection rowCard oauthConfigured status',
    );
    s = replaceOnce(
      s,
      `\t\t\t\t\t\t\t\t\t\t\t\tcredentialConfigured ? (0, react_jsx_runtime.jsx)("span", {`,
      `\t\t\t\t\t\t\t\t\t\t\t\toauthConfigured ? (0, react_jsx_runtime.jsxs)("span", {\n\t\t\t\t\t\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["accountStatus"],\n\t\t\t\t\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotConfigured"]}\`,\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t"aria-hidden": "true"\n\t\t\t\t\t\t\t\t\t\t\t\t\t}), t("oauthBadge")]\n\t\t\t\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\t\t\t\tcredentialConfigured ? (0, react_jsx_runtime.jsx)("span", {`,
      'ModelsSection rowCard OAuth badge',
    );

    // 4g. Locale strings (en + zh)
    s = replaceOnce(
      s,
      `keyRequired: "Enter an API key to continue."`,
      `keyRequired: "Enter an API key to continue.",\n\t\t\toauthTitle: "OAuth sign-in",\n\t\t\toauthSignedIn: "Signed in with OAuth",\n\t\t\toauthBadge: "OAuth",\n\t\t\toauthReconnect: "Reconnect OAuth",\n\t\t\toauthSignOut: "Sign out",\n\t\t\toauthOpenBrowser: "Open sign-in page in browser",\n\t\t\toauthCopyCode: "Copy code",\n\t\t\toauthCopied: "Copied",\n\t\t\toauthSubmit: "Submit",\n\t\t\toauthFailed: "OAuth sign-in failed."`,
      'en locale oauth keys',
    );
    s = replaceOnce(
      s,
      `keyRequired: "请输入 API 密钥后继续。"`,
      `keyRequired: "请输入 API 密钥后继续。",\n\t\t\toauthTitle: "OAuth 登录",\n\t\t\toauthSignedIn: "已通过 OAuth 登录",\n\t\t\toauthBadge: "OAuth",\n\t\t\toauthReconnect: "重新授权",\n\t\t\toauthSignOut: "退出登录",\n\t\t\toauthOpenBrowser: "在浏览器中打开登录页",\n\t\t\toauthCopyCode: "复制验证码",\n\t\t\toauthCopied: "已复制",\n\t\t\toauthSubmit: "提交",\n\t\t\toauthFailed: "OAuth 登录失败。"`,
      'zh locale oauth keys',
    );

    put(p, s);
  }

  must(true, 'oauth patches applied');
  report.push('pi-ai OAuth: added Google/Vertex (PKCE + ADC), Qwen (Device PKCE), MiniMax Global/CN (PKCE user_code), and qwen-portal provider');
  report.push('pi-ai Google adapters: GoogleGenAI and Vertex AI accept OAuth Bearer tokens via OAuth2Client');
  report.push('dsh-llm-pi-ai: enabled OpenAI ChatGPT OAuth with persisted .oauth-device-id and OAuth record fallback in resolveApiKey');
  report.push('Settings UI & RPC: exposed ctx.authorization flows in CredentialsController (host + remote) and Settings -> Models');
}
