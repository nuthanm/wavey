/**
 * Local + production: same-origin `/api/*`.
 * Vite middleware serves the convert API in dev (no second port / CORS).
 * Vercel serves `api/` routes in production.
 */
export function apiBase(): string {
  return ''
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return p
}
