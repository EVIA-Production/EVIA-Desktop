import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * The scripted "What should I say next?" answers for demo shoots.
 *
 * Read on every request so the lines can be edited between two presses
 * without restarting the app. Source, in order of precedence:
 *   1. TAYLOS_DEMO_SUGGESTIONS (a JSON array, or lines separated by "|||")
 *   2. <repo>/demo/suggestions.json
 * Dev only: demo mode never exists in a packaged build.
 */
export function readDemoSuggestions(): string[] {
  const fromEnv = parseSuggestions(process.env.TAYLOS_DEMO_SUGGESTIONS)
  if (fromEnv.length) return fromEnv

  try {
    const file = path.join(app.getAppPath(), 'demo', 'suggestions.json')
    if (!fs.existsSync(file)) return []
    return parseSuggestions(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.warn('[DemoMode] Could not read demo/suggestions.json:', error)
    return []
  }
}

function parseSuggestions(raw: string | undefined): string[] {
  const text = (raw || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return clean(parsed)
  } catch {
    // Not JSON: fall through to the plain separator form.
  }
  return clean(text.split('|||'))
}

function clean(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}
