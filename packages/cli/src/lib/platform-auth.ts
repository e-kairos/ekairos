import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { arch, homedir, release, type as osType } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";

const DEFAULT_PLATFORM_URL = "https://platform.ekairos.dev";
const AUTH_PATH = "/api/auth";
const CLIENT_NAME = "Ekairos CLI";
const CLIENT_SCOPE = "openid profile email offline_access";
const CLIENT_REGISTRATION_VERSION = 1;
const REGISTERED_LOOPBACK_REDIRECT_URI = "http://127.0.0.1/oauth/callback";
const LOOPBACK_CALLBACK_PATH = "/oauth/callback";
const TOKEN_REFRESH_GRACE_MS = 60_000;
const AUTH_TIMEOUT_MS = 180_000;

type DiscoveryDocument = {
  authorization_endpoint: string;
  issuer: string;
  registration_endpoint?: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};

type RegistrationResponse = {
  client_id?: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
};

export type PlatformAuthUser = {
  email?: string;
  emailVerified?: boolean;
  id: string;
  name?: string;
};

type UserInfoResponse = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub?: string;
};

type StoredAuth = {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  clientId?: string;
  clientRegistrationVersion?: number;
  idToken?: string;
  issuer: string;
  platformUrl: string;
  refreshToken?: string;
  scope: string;
  tokenType?: string;
  user?: PlatformAuthUser;
};

type LoopbackResult = {
  code: string;
  state: string;
};

export class PlatformAuthError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "PlatformAuthError";
    this.exitCode = exitCode;
  }
}

function normalizeUrl(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

export function resolvePlatformUrl(value?: string): string {
  return normalizeUrl(
    value || process.env.EKAIROS_PLATFORM_URL || DEFAULT_PLATFORM_URL,
  );
}

function issuerUrl(platformUrl: string): string {
  return `${platformUrl}${AUTH_PATH}`;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier(): string {
  return toBase64Url(randomBytes(48));
}

function createCodeChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest());
}

function createRandomState(): string {
  return toBase64Url(randomBytes(32));
}

function getStorePath(platformUrl: string): string {
  const root = process.env.EKAIROS_CLI_HOME || join(homedir(), ".ekairos");
  const key = toBase64Url(createHash("sha256").update(platformUrl).digest()).slice(
    0,
    16,
  );
  return join(root, "auth", `${key}.json`);
}

async function readStoredAuth(platformUrl: string): Promise<StoredAuth | null> {
  try {
    const payload = await fs.readFile(getStorePath(platformUrl), "utf8");
    return JSON.parse(payload) as StoredAuth;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeStoredAuth(
  platformUrl: string,
  value: StoredAuth,
): Promise<void> {
  const path = getStorePath(platformUrl);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function clearStoredAuth(platformUrl: string): Promise<void> {
  await fs.rm(getStorePath(platformUrl), { force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new PlatformAuthError(
        `Expected JSON from ${url}, received ${response.status}: ${text
          .replace(/\s+/g, " ")
          .slice(0, 180)}`,
      );
    }
  }

  if (!response.ok) {
    const record =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const message =
      record.error_description ?? record.message ?? response.statusText;
    throw new PlatformAuthError(`${response.status} ${String(message)}`);
  }

  return data as T;
}

async function discover(platformUrl: string): Promise<DiscoveryDocument> {
  return fetchJson<DiscoveryDocument>(
    `${issuerUrl(platformUrl)}/.well-known/openid-configuration`,
  );
}

function operatingSystemLabel(): string {
  if (process.platform === "win32") return `Windows ${release()}`;
  if (process.platform === "darwin") return `macOS ${release()}`;
  if (process.platform === "linux") return `Linux ${release()}`;
  return `${osType()} ${release()}`;
}

function clientRegistrationMetadata() {
  return {
    client_name: `${CLIENT_NAME} - ${operatingSystemLabel()} - ${arch()}`,
    software_id: "dev.ekairos.cli",
    software_version: "0.1.0",
  };
}

async function registerPublicClient(
  discovery: DiscoveryDocument,
): Promise<string> {
  if (!discovery.registration_endpoint) {
    throw new PlatformAuthError(
      "OAuth dynamic registration endpoint is not available.",
    );
  }

  const registered = await fetchJson<RegistrationResponse>(
    discovery.registration_endpoint,
    {
      body: JSON.stringify({
        ...clientRegistrationMetadata(),
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [REGISTERED_LOOPBACK_REDIRECT_URI],
        response_types: ["code"],
        scope: CLIENT_SCOPE,
        token_endpoint_auth_method: "none",
        type: "native",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!registered.client_id) {
    throw new PlatformAuthError("OAuth registration did not return a client_id.");
  }

  return registered.client_id;
}

async function getOrRegisterClientId(
  platformUrl: string,
  discovery: DiscoveryDocument,
): Promise<string> {
  const stored = await readStoredAuth(platformUrl);
  if (
    stored?.clientId &&
    stored.issuer === discovery.issuer &&
    stored.clientRegistrationVersion === CLIENT_REGISTRATION_VERSION
  ) {
    return stored.clientId;
  }

  return registerPublicClient(discovery);
}

function callbackPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#050505;color:#f4f4f5;font-family:Inter,Segoe UI,Arial,sans-serif;display:grid;min-height:100vh;place-items:center}main{max-width:460px;padding:32px}h1{font-size:18px;font-weight:600;margin:0 0 10px}p{color:#a1a1aa;font-size:13px;line-height:1.6;margin:0}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

async function startLoopbackServer(expectedState: string): Promise<{
  redirectUri: string;
  server: Server;
  waitForCallback: Promise<LoopbackResult>;
}> {
  const server = createServer();
  let timeout: NodeJS.Timeout | undefined;

  const waitForCallback = new Promise<LoopbackResult>((resolve, reject) => {
    server.on("request", (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (requestUrl.pathname !== LOOPBACK_CALLBACK_PATH) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");
      const state = requestUrl.searchParams.get("state") ?? "";
      const code = requestUrl.searchParams.get("code") ?? "";

      if (error) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(
          callbackPage(
            "Ekairos authorization denied.",
            "You can close this tab and return to the terminal.",
          ),
          () => reject(new PlatformAuthError(errorDescription ?? error)),
        );
        return;
      }

      if (state !== expectedState || !code) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(
          callbackPage(
            "Invalid Ekairos authorization response.",
            "Return to the terminal and start sign-in again.",
          ),
          () => reject(new PlatformAuthError("Invalid OAuth callback.")),
        );
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        callbackPage(
          "Ekairos CLI is connected.",
          "You can close this tab and return to the terminal.",
        ),
        () => resolve({ code, state }),
      );
    });

    timeout = setTimeout(() => {
      reject(new PlatformAuthError("OAuth sign-in timed out."));
    }, AUTH_TIMEOUT_MS);
  }).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${address.port}${LOOPBACK_CALLBACK_PATH}`,
    server,
    waitForCallback,
  };
}

function browserAuthorizeUrl(platformUrl: string, authorizeUrl: URL): string {
  const browserUrl = new URL(`${platformUrl}/oauth/authorize`);
  browserUrl.search = authorizeUrl.search;
  return browserUrl.toString();
}

async function openBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/d", "/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}

async function exchangeAuthorizationCode(
  discovery: DiscoveryDocument,
  input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });

  return fetchJson<TokenResponse>(discovery.token_endpoint, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
}

async function fetchUserInfo(
  discovery: DiscoveryDocument,
  accessToken: string,
): Promise<PlatformAuthUser> {
  if (!discovery.userinfo_endpoint) {
    throw new PlatformAuthError(
      "OAuth discovery document did not include a userinfo endpoint.",
    );
  }

  const userInfo = await fetchJson<UserInfoResponse>(
    discovery.userinfo_endpoint,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!userInfo.sub) {
    throw new PlatformAuthError("OAuth userinfo response did not include a subject.");
  }

  return {
    email: userInfo.email,
    emailVerified: userInfo.email_verified,
    id: userInfo.sub,
    name: userInfo.name,
  };
}

async function createStoredAuth(
  platformUrl: string,
  discovery: DiscoveryDocument,
  clientId: string,
  token: TokenResponse,
  previous?: StoredAuth,
): Promise<StoredAuth> {
  if (!token.access_token) {
    throw new PlatformAuthError(
      "OAuth token response did not include an access token.",
    );
  }

  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : undefined;

  return {
    accessToken: token.access_token,
    accessTokenExpiresAt: expiresAt,
    clientId,
    clientRegistrationVersion: CLIENT_REGISTRATION_VERSION,
    idToken: token.id_token ?? previous?.idToken,
    issuer: discovery.issuer,
    platformUrl,
    refreshToken: token.refresh_token ?? previous?.refreshToken,
    scope: CLIENT_SCOPE,
    tokenType: token.token_type ?? previous?.tokenType,
    user: await fetchUserInfo(discovery, token.access_token),
  };
}

function isAccessTokenFresh(stored: StoredAuth): boolean {
  if (!stored.accessToken) return false;
  if (!stored.accessTokenExpiresAt) return true;
  return (
    Date.parse(stored.accessTokenExpiresAt) - TOKEN_REFRESH_GRACE_MS >
    Date.now()
  );
}

async function refreshAccessToken(
  platformUrl: string,
  discovery: DiscoveryDocument,
  stored: StoredAuth,
): Promise<StoredAuth> {
  if (!stored.refreshToken) {
    throw new PlatformAuthError("platform_refresh_token_missing");
  }
  if (!stored.clientId) {
    throw new PlatformAuthError("platform_oauth_client_id_missing");
  }

  const body = new URLSearchParams({
    client_id: stored.clientId,
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });

  const token = await fetchJson<TokenResponse>(discovery.token_endpoint, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  const next = await createStoredAuth(
    platformUrl,
    discovery,
    stored.clientId,
    token,
    stored,
  );
  await writeStoredAuth(platformUrl, next);
  return next;
}

export async function getPlatformAccessToken(
  platformUrlInput?: string,
): Promise<{
  accessToken: string;
  platformUrl: string;
  user?: PlatformAuthUser;
} | null> {
  const platformUrl = resolvePlatformUrl(platformUrlInput);
  let stored = await readStoredAuth(platformUrl);
  if (!stored?.accessToken) return null;

  if (stored.issuer !== issuerUrl(platformUrl) || stored.platformUrl !== platformUrl) {
    await clearStoredAuth(platformUrl);
    return null;
  }

  if (!isAccessTokenFresh(stored)) {
    const discovery = await discover(platformUrl);
    stored = await refreshAccessToken(platformUrl, discovery, stored);
  }

  if (!stored.accessToken) return null;
  return {
    accessToken: stored.accessToken,
    platformUrl,
    user: stored.user,
  };
}

export async function signInToPlatform(options: {
  dryRun?: boolean;
  noOpen?: boolean;
  platformUrl?: string;
} = {}): Promise<StoredAuth | { authorizeUrl: string; clientId: string; issuer: string; platformUrl: string }> {
  const platformUrl = resolvePlatformUrl(options.platformUrl);
  const discovery = await discover(platformUrl);
  const clientId = await getOrRegisterClientId(platformUrl, discovery);
  const state = createRandomState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("redirect_uri", REGISTERED_LOOPBACK_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", CLIENT_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  if (options.dryRun) {
    return {
      authorizeUrl: browserAuthorizeUrl(platformUrl, authorizeUrl),
      clientId,
      issuer: discovery.issuer,
      platformUrl,
    };
  }

  const loopback = await startLoopbackServer(state);
  authorizeUrl.searchParams.set("redirect_uri", loopback.redirectUri);
  const loginUrl = browserAuthorizeUrl(platformUrl, authorizeUrl);

  if (options.noOpen || process.env.EKAIROS_AUTH_NO_OPEN === "1") {
    process.stdout.write(`${loginUrl}\n`);
  } else {
    await openBrowser(loginUrl);
  }

  try {
    const callback = await loopback.waitForCallback;
    const token = await exchangeAuthorizationCode(discovery, {
      clientId,
      code: callback.code,
      codeVerifier,
      redirectUri: loopback.redirectUri,
    });
    const stored = await createStoredAuth(platformUrl, discovery, clientId, token);
    await writeStoredAuth(platformUrl, stored);
    return stored;
  } finally {
    loopback.server.close();
  }
}

export async function signOutFromPlatform(platformUrlInput?: string): Promise<void> {
  await clearStoredAuth(resolvePlatformUrl(platformUrlInput));
}

