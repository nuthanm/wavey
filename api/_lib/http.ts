import type { VercelRequest, VercelResponse } from '@vercel/node'

export function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.status(204).end()
    return true
  }
  return false
}

export function sendJson(res: VercelResponse, status: number, body: unknown) {
  setCors(res)
  res.status(status).json(body)
}

export function sendError(
  res: VercelResponse,
  status: number,
  message: string,
  extra?: { code?: string; hint?: string },
) {
  sendJson(res, status, {
    ok: false,
    error: message,
    ...(extra?.code ? { code: extra.code } : {}),
    ...(extra?.hint ? { hint: extra.hint } : {}),
  })
}

export async function readJsonBody<T>(req: VercelRequest): Promise<T> {
  if (req.body && typeof req.body === 'object') return req.body as T
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body) as T
  }
  // Rare: body not parsed yet
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {} as T
  return JSON.parse(raw) as T
}
