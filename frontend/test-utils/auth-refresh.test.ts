import { refreshAccessTokenOnce, requestWithRefresh, singleFlight } from "@/lib/auth-refresh";

/**
 * FE-82 acceptance: ten concurrent 401s must trigger exactly one
 * refresh call. CT-65 / BE-137 dependencies.
 */
describe("refreshAccessTokenOnce single-flight", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __authSingleFlight?: Record<string, Promise<unknown>> }).__authSingleFlight = undefined;
    }
  });

  it("ten concurrent refresh calls produce exactly one fetch", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ accessToken: "new-tok" }),
    })) as unknown as jest.Mock;

    const calls = Array.from({ length: 10 }, () =>
      refreshAccessTokenOnce({ fetcher: fetchMock as unknown as typeof fetch })
    );
    const tokens = await Promise.all(calls);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokens.every((t) => t === "new-tok")).toBe(true);
  });

  it("singleFlight dedupes concurrent invocations of the same key", async () => {
    let counter = 0;
    const fn = jest.fn(async () => {
      counter += 1;
      return counter;
    });
    const concurrent = Array.from({ length: 5 }, () => singleFlight("dedupe-key", fn));
    const results = await Promise.all(concurrent);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([1, 1, 1, 1, 1]);
  });

  it("requestWithRefresh retries once with the new token on 401", async () => {
    let calls = 0;
    const fetchMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as jest.Mock;

    const res = await requestWithRefresh(
      "/api/me",
      undefined,
      { fetcher: fetchMock as unknown as typeof fetch }
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial 401, refresh, retry
  });
});
