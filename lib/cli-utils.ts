/**
 * Extract a JSON value from CLI output that may contain non-JSON preamble.
 *
 * Some OpenClaw versions print validation warnings or debug log lines
 * (e.g. "[plugins] [debug] ...") to stdout before the JSON payload.
 * This function finds the actual JSON structure by trying each `[` or `{`
 * position until one parses successfully.
 */
export function extractJson(raw: string): unknown {
  // Fast path: raw is already valid JSON
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // May start with [ but be a log line like "[plugins] ..." -- fall through
    }
  }

  // Try each potential JSON start position
  let pos = 0
  while (pos < raw.length) {
    const arrStart = raw.indexOf('[', pos)
    const objStart = raw.indexOf('{', pos)
    const candidates = [arrStart, objStart].filter(i => i >= 0)
    if (candidates.length === 0) break

    const start = Math.min(...candidates)
    try {
      return JSON.parse(raw.slice(start))
    } catch {
      // This wasn't the real JSON start -- advance past it
      pos = start + 1
    }
  }

  throw new SyntaxError('No JSON found in CLI output')
}

export function extractJobsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.jobs)) return record.jobs
    if (Array.isArray(record.data)) return record.data
  }
  return []
}
