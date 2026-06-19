// ============================================================================
// Shared test helpers for the camera-cloud-adapter adapter unit tests.
// Not part of the deployed Edge Function bundle (index.ts never imports this).
// ============================================================================

export type MockResponse =
  | { json: unknown; status?: number }
  | { networkError: string }
  | { nonJson: true; status?: number }

export type FetchCall = { url: string; body: string }

/** Mock fetch that returns responses in call order, regardless of URL. */
export function createMockFetch(responses: MockResponse[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let i = 0
  const fetchFn = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    const r = responses[i]
    i++
    if (!r) throw new Error(`createMockFetch: no response configured for call #${i}`)
    if ('networkError' in r) throw new Error(r.networkError)
    if ('nonJson' in r) return new Response('not json', { status: r.status ?? 200 })
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch: fetchFn as typeof fetch, calls }
}

/** Mock fetch that picks a response based on which path the URL contains. Each path may have a queue of responses (consumed in order) or a single reusable response. */
export function createUrlRoutedFetch(routes: Record<string, MockResponse | MockResponse[]>): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const counters: Record<string, number> = {}
  const fetchFn = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    calls.push({ url: u, body: String(init?.body ?? '') })
    const key = Object.keys(routes).find((k) => u.includes(k))
    if (!key) throw new Error(`createUrlRoutedFetch: no route configured for ${u}`)
    const entry = routes[key]
    let r: MockResponse | undefined
    if (Array.isArray(entry)) {
      const idx = counters[key] ?? 0
      r = entry[idx]
      counters[key] = idx + 1
    } else {
      r = entry
    }
    if (!r) throw new Error(`createUrlRoutedFetch: no response left for ${key}`)
    if ('networkError' in r) throw new Error(r.networkError)
    if ('nonJson' in r) return new Response('not json', { status: r.status ?? 200 })
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch: fetchFn as typeof fetch, calls }
}

/** Installs a mock fetch on globalThis for the duration of an async test body, then restores it. */
export async function withMockFetch<T>(mockFetch: typeof fetch, run: () => Promise<T> | T): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = mockFetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}
