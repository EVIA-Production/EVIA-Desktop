/**
 * Keep the TLS connection to the API hot for the whole call.
 *
 * Measured 2026-08-18 from Jakarta to the West Europe deployment, against
 * /health, which does no work at all:
 *
 *     req1 (cold):  tcp=294ms  tls=269ms  total=777ms
 *     req2 (warm):  tcp=0      tls=0      total=247ms
 *     req3 (warm):  tcp=0      tls=0      total=225ms
 *
 * The handshake costs ~530ms, and it is paid by whichever request happens to
 * be first. That is the whole of "the first suggestion is always slower" - the
 * model has no warm-up, the socket does. A seller mid-sentence pays half a
 * second for TCP and TLS before a single byte of their question is sent.
 *
 * Chromium closes idle keep-alive sockets, so one warm-up at session start is
 * not enough for a call with pauses between clicks: the second suggestion
 * after a quiet minute pays the handshake again. Hence the heartbeat.
 *
 * The saving scales with distance. From Germany, where the users are, the same
 * handshake is tens of milliseconds rather than hundreds - so this matters most
 * for exactly the person testing from the far side of the planet, and still
 * removes a real cost for everyone else.
 */

const HEARTBEAT_MS = 25_000 // comfortably inside Chromium's idle-socket timeout

let heartbeat: ReturnType<typeof setInterval> | null = null

async function touch(baseUrl: string): Promise<void> {
  try {
    // GET /health is the cheapest endpoint that still performs the full
    // TCP + TLS + HTTP path, so the socket it leaves behind is the one the
    // next /ask reuses. keepalive lets it survive a renderer navigation.
    await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    })
  } catch {
    // A failed warm-up must never surface: it is an optimisation, and the
    // real request carries its own error handling.
  }
}

/** Open the connection now, then keep it from going idle until stopped. */
export function startConnectionWarmup(baseUrl: string): void {
  if (!baseUrl) return
  stopConnectionWarmup()
  void touch(baseUrl)
  heartbeat = setInterval(() => void touch(baseUrl), HEARTBEAT_MS)
  console.log('[Warmup] TLS connection primed and held open')
}

export function stopConnectionWarmup(): void {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
    console.log('[Warmup] connection heartbeat stopped')
  }
}
