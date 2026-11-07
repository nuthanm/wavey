/** Server-side Gen-Z error strings (keep in sync with src/lib/errors.ts intent). */

export function friendlyApiError(raw: unknown): { error: string; code: string; hint?: string } {
  const msg = raw instanceof Error ? raw.message : String(raw || 'unknown')
  const lower = msg.toLowerCase()

  if (/too many|rate/.test(lower)) {
    return {
      code: 'rate_limit',
      error: 'slow down bestie — too many pulls.',
      hint: 'wait ~30s and try again.',
    }
  }
  if (/ig_sessionid|stories need|session cookie/.test(lower)) {
    return {
      code: 'ig_story_auth',
      error: 'stories need a server session cookie.',
      hint: 'set IG_SESSIONID, or pull a public reel instead.',
    }
  }
  if (/expired|fresher session/.test(lower) && /story/.test(lower)) {
    return {
      code: 'ig_expired',
      error: 'that story vanished or the session went stale.',
      hint: 'refresh IG_SESSIONID or grab it before the 24h fade.',
    }
  }
  if (/private|login required/.test(lower)) {
    return {
      code: 'private',
      error: 'this one’s locked — public links only.',
      hint: 'try a public youtube video or public reel.',
    }
  }
  if (/age|confirm your age|sign in to confirm/.test(lower)) {
    return {
      code: 'yt_age',
      error: 'age-gated — youtube is gatekeeping this one.',
      hint: 'public vids only, or set YT_COOKIE on the server.',
    }
  }
  if (/region|country|geo/.test(lower)) {
    return {
      code: 'yt_region',
      error: 'geo blocked in this region.',
      hint: 'pick a link that plays where you are.',
    }
  }
  if (/decipher|no valid url/.test(lower)) {
    return {
      code: 'yt_decipher',
      error: 'couldn’t unlock the stream url.',
      hint: 'retry, or set YT_COOKIE in .env.local.',
    }
  }
  if (/token expired/.test(lower)) {
    return {
      code: 'token_expired',
      error: 'pull timed out — token expired.',
      hint: 'tap pull again for a fresh token.',
    }
  }
  if (/invalid token|signature/.test(lower)) {
    return {
      code: 'token_invalid',
      error: 'that download token is sus.',
      hint: 'resolve the link again, then pull.',
    }
  }
  if (/only youtube and instagram|unsupported/.test(lower)) {
    return {
      code: 'unsupported_host',
      error: 'wavey only pulls youtube + instagram rn.',
      hint: 'drop a yt / ig link.',
    }
  }
  if (/invalid url|url is required|could not parse/.test(lower)) {
    return {
      code: 'bad_url',
      error: 'that link looks mid.',
      hint: 'paste a full youtube or instagram url.',
    }
  }
  if (/instagram|could not resolve|could not extract/.test(lower)) {
    return {
      code: 'ig_not_found',
      error: 'couldn’t find that ig media.',
      hint: 'confirm it’s public and not deleted.',
    }
  }
  if (/not playable|no streams|youtube/.test(lower)) {
    return {
      code: 'yt_unavailable',
      error: 'youtube said no to that video.',
      hint: 'retry once — it may be restricted.',
    }
  }

  return {
    code: 'generic',
    error: msg.slice(0, 180) || 'something glitched.',
    hint: 'try again in a sec.',
  }
}
