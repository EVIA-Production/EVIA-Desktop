import { trialLimitError, trialLimitFrom } from './trial-limit'

/**
 * Where the query came from. The backend cannot recover this from the text:
 * a summary bullet the user taps and a question the user types are both just
 * strings, and reading one as the other is how "Wie steht es um das Budget?"
 * came back as a definition instead of a line to say. Only the client knows,
 * because each origin enters through a different handler.
 */
export type AskQuerySource =
  | 'user_typed'      // typed into the ask box
  | 'quick_action'    // pressed a button whose prompt we authored
  | 'insight_click'   // tapped a bullet Taylos summarised from the transcript
  | 'shortcut'        // pressed the next-step keyboard shortcut

export type StreamAskParams = {
  baseUrl: string
  chatId: number
  prompt: string
  transcript?: string          // NEW: Full transcript context for backend
  language: 'de' | 'en'
  sessionState?: 'before' | 'during' | 'after'  // NEW: Session state for context-aware responses
  token: string
  tokenType?: string
  signal?: AbortSignal
  screenshotRef?: string
  requestId?: string
  clientStartedAtMs?: number
  querySource?: AskQuerySource
}

export type StreamAskHandle = {
  onDelta: (cb: (delta: string) => void) => void
  onReplace: (cb: (text: string) => void) => void
  onDone: (cb: () => void) => void
  onError: (cb: (err: Error) => void) => void
  abort: () => void
}

export function streamAsk({ baseUrl, chatId, prompt, transcript, language, sessionState, token, tokenType = 'Bearer', signal, screenshotRef, requestId, clientStartedAtMs, querySource }: StreamAskParams): StreamAskHandle {
  const url = `${baseUrl.replace(/\/$/, '')}/ask`
  const headers: Record<string, string> = {
    'Authorization': `${tokenType} ${token}`,
    'Content-Type': 'application/json'
  }
  
  // GLASS PARITY: Send transcript as main prompt, question as prompt_override
  // Backend expects: prompt = transcript context, prompt_override = user question
  const payload: any = { 
    chat_id: chatId, 
    prompt: transcript || prompt,  // Use transcript if available, otherwise just prompt
    language, 
    stream: true,
    stream_live_advice: true,
    request_id: requestId,
    client_started_at_ms: clientStartedAtMs,
    query_source: querySource,
  }
  
  // SESSION STATE: Add session state for context-aware responses
  if (sessionState) {
    payload.session_state = sessionState;
    console.log('[evia-ask-stream] 🎯 Session state:', sessionState);
  } else {
    console.log('[evia-ask-stream] ⚠️ No session state provided - backend will default to "during"');
  }
  
  // If we have both transcript AND a user question (not just transcript alone)
  if (transcript && prompt && transcript !== prompt) {
    payload.prompt_override = prompt;  // Send question separately for Glass pattern
    // The backend reads `transcript` first and only then falls back to the
    // Glass convention above. Measured 2026-09-17 (chat 1935): without the
    // explicit field the server preferred its own one-speaker Redis buffer
    // over the 563 characters this click carried, and the seller read
    // "Wo wundern Sie sich?" aloud. Both fields, so the contract is explicit.
    payload.transcript = transcript;
    console.log('[evia-ask-stream] 📄 Sending with transcript context:', transcript.length, 'chars + question:', prompt.substring(0, 50));
  } else if (!transcript) {
    console.log('[evia-ask-stream] ⚠️ No transcript context - sending question only');
  }
  
  if (screenshotRef) {
    payload.screenshot_ref = screenshotRef
  }
  const body = JSON.stringify(payload)

  let deltaHandler: (delta: string) => void = () => {}
  let replaceHandler: (text: string) => void = () => {}
  let doneHandler: () => void = () => {}
  let errorHandler: (err: Error) => void = () => {}

  const controller = new AbortController()
  const outerSignal = signal
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let finished = false
  let receivedText = false
  const abort = () => {
    finished = true
    controller.abort()
    void reader?.cancel().catch(() => {})
  }

  if (outerSignal) {
    if (outerSignal.aborted) abort()
    else outerSignal.addEventListener('abort', abort, { once: true })
  }

  const consumeLine = (raw: string) => {
    if (finished || !raw.trim()) return
    let obj: any
    try { obj = JSON.parse(raw) }
    catch { throw new Error('Malformed JSONL line') }
    const route = obj?.meta || (obj?.type === 'provider_route' ? obj : null)
    if (route) {
      if (route?.type === 'trial_budget_error') {
        const notice = trialLimitFrom(route)
        if (notice) throw trialLimitError(notice)
      }
      if (route.type === 'provider_error') {
        throw new Error(`SUGGESTION_UNAVAILABLE:${String(route.reason || 'suggestion_unavailable')}`)
      }
      if (route?.type === 'request_trace') {
        console.log(`[Ask][Trace] request=${String(route.request_id || 'unknown')} server_pre_stream_ms=${String(route.server_pre_stream_ms ?? 'unknown')}`)
      } else {
        const tokens = route.estimated_input_tokens
        const threshold = route.context_switch_threshold
        console.log(
          `[Ask][ProviderRoute] provider=${String(route.provider || 'unknown')} model=${String(route.model || 'unknown')} reason=${String(route.reason || 'unknown')}` +
          (Number.isFinite(tokens) ? ` tokens=${tokens}` : '') +
          (Number.isFinite(threshold) ? ` threshold=${threshold}` : '')
        )
      }
    }
    // An empty replacement is meaningful: the final guard can retract a preview.
    if (obj?.replace === true && typeof obj.text === 'string') {
      receivedText = true
      try { replaceHandler(obj.text) } catch {}
    }
    if (finished) return
    if (typeof obj?.delta === 'string' && obj.delta) {
      receivedText = true
      try { deltaHandler(obj.delta) } catch {}
    }
    if (finished) return
    if (obj?.done === true) {
      finished = true
      try { doneHandler() } catch {}
    }
  }

  ;(async () => {
    // CRITICAL FIX: Retry logic for transient errors (Ask endpoint)
    const MAX_RETRIES = 2; // Shorter for streaming (user expects fast response)
    const RETRY_DELAY = 1500;
    
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (finished) return
      try {
        console.log(`[Ask] Sending request (attempt ${attempt + 1}/${MAX_RETRIES})`);
        const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
        
        if (!res.ok) {
          // A trial limit is an answer, not a failure: say what ran out and
          // offer the upgrade instead of "Request failed. Reconnect?".
          if (res.status === 402) {
            const body = await res.json().catch(() => null)
            const notice = trialLimitFrom(body)
            if (notice) {
              throw trialLimitError(notice)
            }
          }
          // Only retry on 5xx errors
          if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
            await res.body?.cancel()
            console.warn(`[Ask] ⚠️ Server error ${res.status}, retrying in ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            continue;
          }
          throw new Error(`HTTP ${res.status}`)
        }
        
        if (finished) {
          await res.body?.cancel()
          return
        }
        reader = res.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (!finished) {
          const { done, value } = await reader.read()
          if (finished) return
          if (done) {
            buffer += decoder.decode()
            consumeLine(buffer)
            if (!finished) throw new Error('Incomplete Ask stream')
            return
          }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const raw of lines) {
            consumeLine(raw)
            if (finished) return
          }
        }
        
        // Success - break out of retry loop
        return;
      } catch (err: any) {
        if (finished || err?.name === 'AbortError') return;
        
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Retry on network errors only
        const isNetworkError = err instanceof TypeError || 
                               (err instanceof Error && err.message.includes('Failed to fetch'));
        
        if (!receivedText && isNetworkError && attempt < MAX_RETRIES - 1) {
          console.warn(`[Ask] ⚠️ Network error, retrying in ${RETRY_DELAY}ms...`, err);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        
        // Final error - emit to handler
        finished = true
        try { errorHandler(lastError) } catch {}
        return;
      } finally {
        if (reader) {
          try { await reader.cancel() } catch {}
          reader.releaseLock()
          reader = undefined
        }
      }
    }
  })().finally(() => outerSignal?.removeEventListener('abort', abort))

  return {
    onDelta(cb) { deltaHandler = cb; return undefined as any },
    onReplace(cb) { replaceHandler = cb; return undefined as any },
    onDone(cb) { doneHandler = cb; return undefined as any },
    onError(cb) { errorHandler = cb; return undefined as any },
    abort,
  }
}
