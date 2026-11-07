/**
 * In local Vite dev, call the API on :8787 directly.
 * Vite's proxy hangs up on long YouTube streams (502 / socket hang up).
 * In production (Vercel) we stay same-origin with an empty base.
 */
export function apiBase(): string {
  if (import.meta.env.DEV) {
    return (import.meta.env.VITE_API_BASE as string | undefined) || 'http://127.0.0.1:8787'
  }
  return ''
}

export function apiUrl(path: string): string {
  const base = apiBase().replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}
