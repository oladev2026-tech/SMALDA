/**
 * Single-flight 401 refresh utilities. When a request gets a 401,
 * concurrent in-flight requests must each await a single shared
 * refresh Promise rather than stampeding the /auth/refresh endpoint.
 *
 * After a successful refresh the original request is retried exactly
 * once with the new token. If the refresh fails, the original 401
 * propagates so the caller can route the user to the locale-prefixed
 * /login page (which now preserves the original destination via
 * the locale-aware middleware redirect).
 */

const REFRESH_KEY = "/auth/refresh";

interface SingleFlightRegistry {
  [key: string]: Promise<unknown>;
}

declare global {
  interface Window {
    __authSingleFlight?: SingleFlightRegistry;
  }
}

function getRegistry(): SingleFlightRegistry {
  if (typeof window === "undefined") {
    const g = globalThis as unknown as { __authSingleFlight?: SingleFlightRegistry };
    if (!g.__authSingleFlight) g.__authSingleFlight = {};
    return g.__authSingleFlight;
  }
  if (!window.__authSingleFlight) {
    window.__authSingleFlight = {};
  }
  return window.__authSingleFlight;
}

/**
 * Coalesces concurrent calls to fn() keyed by `key`. Subsequent
 * callers arriving while the first is still in flight receive the
 * same Promise; after it resolves, the next call triggers a fresh run.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const reg = getRegistry();
  const inflight = reg[key];
  if (inflight) return inflight as Promise<T>;
  const p = fn().finally(() => {
    delete reg[key];
  });
  reg[key] = p;
  return p;
}

export interface RefreshOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
}

/**
 * Performs a single POST to the refresh endpoint. Returns the new
 * access token if any, otherwise null. Wrapped in singleFlight so 10
 * concurrent 401s trigger exactly one POST.
 */
export async function refreshAccessTokenOnce(
  opts: RefreshOptions = {},
): Promise<string | null> {
  return singleFlight(REFRESH_KEY, async () => {
    const endpoint = opts.endpoint ?? "/api/auth/refresh";
    const doFetch = opts.fetcher ?? fetch;
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { accessToken?: string };
      return json.accessToken ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Wraps a single request so that on 401 we attempt exactly one refresh
 * via refreshAccessTokenOnce and retry. If the refresh fails, the
 * original 401 propagates to the caller.
 */
export async function requestWithRefresh(
  url: string,
  init: RequestInit = {},
  opts: RefreshOptions = {},
): Promise<Response> {
  const doFetch = opts.fetcher ?? fetch;
  const initial = await doFetch(url, init);
  if (initial.status !== 401) return initial;

  const token = await refreshAccessTokenOnce(opts);
  if (token === null) return initial;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return doFetch(url, { ...init, headers });
}
