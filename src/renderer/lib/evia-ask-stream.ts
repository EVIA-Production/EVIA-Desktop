export type StreamAskParams = {
  baseUrl: string
  chatId: number
  prompt: string
  language: 'de' | 'en'
  token: string
  tokenType?: string
  signal?: AbortSignal
  screenshotRef?: string
}

export type StreamAskHandle = {
  onDelta: (cb: (delta: string) => void) => void
  onDone: (cb: () => void) => void
  onError: (cb: (err: Error) => void) => void
  abort: () => void
}

export function streamAsk({ baseUrl, chatId, prompt, language, token, tokenType = 'Bearer', signal, screenshotRef }: StreamAskParams): StreamAskHandle {
  const url = `${baseUrl.replace(/\/$/, '')}/ask`
  const headers: Record<string, string> = {
    'Authorization': `${tokenType} ${token}`,
    'Content-Type': 'application/json'
  }
  const payload: any = { chat_id: chatId, prompt, language, stream: true }
  if (screenshotRef) {
    payload.screenshot_ref = screenshotRef
  }
  const body = JSON.stringify(payload)

  let deltaHandler: (delta: string) => void = () => {}
  let doneHandler: () => void = () => {}
  let errorHandler: (err: Error) => void = () => {}

  const controller = new AbortController()
  const outerSignal = signal

  if (outerSignal) {
    if (outerSignal.aborted) controller.abort()
    outerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  ;(async () => {
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          try { doneHandler() } catch {}
          break
        }
        buffer += decoder.decode(value, { stream: true })
        let lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const raw of lines) {
          const line = raw.trim()
          if (!line) continue
          let obj: any
          try {
            obj = JSON.parse(line)
          } catch (e) {
            try { errorHandler(new Error('Malformed JSONL line')) } catch {}
            continue
          }
          const delta = typeof obj?.delta === 'string' ? obj.delta : ''
          const doneFlag = obj?.done === true

          if (delta) {
            try { deltaHandler(delta) } catch {}
          }
          if (doneFlag) {
            try { doneHandler() } catch {}
            try { controller.abort() } catch {}
            return
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      try { errorHandler(err instanceof Error ? err : new Error(String(err))) } catch {}
    }
  })()

  return {
    onDelta(cb) { deltaHandler = cb; return undefined as any },
    onDone(cb) { doneHandler = cb; return undefined as any },
    onError(cb) { errorHandler = cb; return undefined as any },
    abort() { try { controller.abort() } catch {} }
  }
}
