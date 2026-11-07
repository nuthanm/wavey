/** Gen-Z friendly copy for every failure path Wavey can hit. */

export type WaveyErrorCode =
  | 'api_down'
  | 'api_timeout'
  | 'api_bad_gateway'
  | 'network'
  | 'rate_limit'
  | 'bad_url'
  | 'wrong_platform'
  | 'unsupported_host'
  | 'yt_private'
  | 'yt_age'
  | 'yt_region'
  | 'yt_unavailable'
  | 'yt_decipher'
  | 'ig_private'
  | 'ig_story_auth'
  | 'ig_expired'
  | 'ig_not_found'
  | 'token_expired'
  | 'token_invalid'
  | 'download_fail'
  | 'encode_fail'
  | 'image_not_video'
  | 'clipboard'
  | 'share_cancel'
  | 'share_unsupported'
  | 'generic'

export type FriendlyError = {
  code: WaveyErrorCode
  title: string
  message: string
  hint?: string
}

const COPY: Record<WaveyErrorCode, Omit<FriendlyError, 'code'>> = {
  api_down: {
    title: 'api ghosted us',
    message: 'wavey can’t reach the backend rn.',
    hint: 'run npm run dev (ui + api). then refresh.',
  },
  api_timeout: {
    title: 'that took forever',
    message: 'the pull timed out before it finished.',
    hint: 'try again — shorter clips / 720p hit different.',
  },
  api_bad_gateway: {
    title: 'proxy said nope',
    message: 'ui talked to the api and got a 502 vibes check fail.',
    hint: 'restart npm run dev. make sure port 8787 isn’t blocked.',
  },
  network: {
    title: 'no signal',
    message: 'your network dropped mid-request.',
    hint: 'check wifi / vpn, then try once more.',
  },
  rate_limit: {
    title: 'slow down bestie',
    message: 'too many pulls too fast.',
    hint: 'wait like 30s and try again.',
  },
  bad_url: {
    title: 'link looks mid',
    message: 'that doesn’t look like a real media url.',
    hint: 'paste a full youtube or instagram link.',
  },
  wrong_platform: {
    title: 'wrong tab energy',
    message: 'this link doesn’t match the tab you’re on.',
    hint: 'switch youtube ↔ instagram, then paste again.',
  },
  unsupported_host: {
    title: 'not that app',
    message: 'wavey only pulls youtube + instagram rn.',
    hint: 'drop a yt / ig link and we’re good.',
  },
  yt_private: {
    title: 'this one’s locked',
    message: 'youtube says private / unavailable.',
    hint: 'public videos only — no unlisted-login gates.',
  },
  yt_age: {
    title: 'age-gated, not today',
    message: 'youtube is gatekeeping this video.',
    hint: 'try a public track, or set YT_COOKIE on the server.',
  },
  yt_region: {
    title: 'geo blocked',
    message: 'this video isn’t available in this region.',
    hint: 'pick another link that plays in your country.',
  },
  yt_unavailable: {
    title: 'youtube said no',
    message: 'couldn’t load that video’s streams.',
    hint: 'retry once. if it keeps failing, the video may be restricted.',
  },
  yt_decipher: {
    title: 'stream fumbled',
    message: 'couldn’t unlock the download url.',
    hint: 'hit pull again. still broken? set YT_COOKIE in .env.local.',
  },
  ig_private: {
    title: 'private reel energy',
    message: 'that post isn’t public — we can’t see it.',
    hint: 'only public reels / posts work without login.',
  },
  ig_story_auth: {
    title: 'stories need a session',
    message: 'stories won’t load without a server cookie.',
    hint: 'set IG_SESSIONID in env, or pull a public reel instead.',
  },
  ig_expired: {
    title: 'story already vanished',
    message: 'that story is gone or the session went stale.',
    hint: 'refresh IG_SESSIONID, or grab it before the 24h fade.',
  },
  ig_not_found: {
    title: 'can’t find that reel',
    message: 'instagram didn’t hand us the media.',
    hint: 'confirm the link is public and not deleted.',
  },
  token_expired: {
    title: 'pull timed out',
    message: 'the download token expired (they’re short-lived on purpose).',
    hint: 'tap pull again — fresh token, same vibe.',
  },
  token_invalid: {
    title: 'token’s sus',
    message: 'that download token isn’t valid.',
    hint: 'resolve the link again, then pull.',
  },
  download_fail: {
    title: 'download flopped',
    message: 'we couldn’t stream the file all the way.',
    hint: 'retry. if it’s huge, drop to 720p / lower bitrate.',
  },
  encode_fail: {
    title: 'mp3 encode fumbled',
    message: 'browser ffmpeg couldn’t finish the convert.',
    hint: 'retry, or pick chill/clean bitrate. hard-refresh if wasm got stuck.',
  },
  image_not_video: {
    title: 'that’s a photo',
    message: 'this post is an image, not a video/reel.',
    hint: 'drop a reel or youtube video link instead.',
  },
  clipboard: {
    title: 'clipboard blocked',
    message: 'browser won’t let us read paste.',
    hint: 'allow clipboard permission, or paste manually.',
  },
  share_cancel: {
    title: 'share cancelled',
    message: 'you closed the share sheet — all good.',
  },
  share_unsupported: {
    title: 'no share sheet here',
    message: 'this device doesn’t support web share.',
    hint: 'just hit download instead.',
  },
  generic: {
    title: 'something glitched',
    message: 'unexpected error — not your fault.',
    hint: 'try again in a sec. still broken? restart npm run dev.',
  },
}

export class WaveyError extends Error {
  code: WaveyErrorCode
  title: string
  hint?: string
  status?: number

  constructor(code: WaveyErrorCode, status?: number, detail?: string) {
    const base = COPY[code] || COPY.generic
    super(detail?.trim() ? `${base.message} (${detail.trim()})` : base.message)
    this.name = 'WaveyError'
    this.code = code
    this.title = base.title
    this.hint = base.hint
    this.status = status
  }

  toFriendly(): FriendlyError {
    return {
      code: this.code,
      title: this.title,
      message: this.message,
      hint: this.hint,
    }
  }
}

function includesAny(hay: string, needles: string[]) {
  return needles.some((n) => hay.includes(n))
}

/** Map raw API / runtime errors into a WaveyError with Gen-Z copy. */
export function toWaveyError(input: unknown, status?: number): WaveyError {
  if (input instanceof WaveyError) return input

  const raw =
    typeof input === 'string'
      ? input
      : input instanceof Error
        ? input.message
        : 'unknown error'
  const msg = raw.toLowerCase()
  const st = status ?? guessStatus(msg)

  if (st === 429 || includesAny(msg, ['too many', 'rate limit', 'slow down'])) {
    return new WaveyError('rate_limit', st)
  }
  if (st === 502 || includesAny(msg, ['502', 'bad gateway', 'proxy'])) {
    return new WaveyError('api_bad_gateway', st)
  }
  if (st === 504 || includesAny(msg, ['timeout', 'timed out', 'aborted'])) {
    return new WaveyError('api_timeout', st)
  }
  if (
    st === 503 ||
    st === 0 ||
    includesAny(msg, [
      'api unavailable',
      'cannot reach',
      'failed to fetch',
      'networkerror',
      'econnrefused',
      'empty response',
      'non-json',
      'port 8787',
    ])
  ) {
    return new WaveyError('api_down', st || 503)
  }

  if (includesAny(msg, ['token expired', 'expired'])) {
    return new WaveyError('token_expired', st)
  }
  if (includesAny(msg, ['token', 'signature', 'invalid token'])) {
    return new WaveyError('token_invalid', st)
  }

  if (includesAny(msg, ['only youtube and instagram', 'unsupported'])) {
    return new WaveyError('unsupported_host', st)
  }
  if (includesAny(msg, ['invalid url', 'url is required', 'could not parse'])) {
    return new WaveyError('bad_url', st)
  }
  if (includesAny(msg, ['switch tab', 'looks like'])) {
    return new WaveyError('wrong_platform', st)
  }

  if (includesAny(msg, ['age', 'sign in to confirm', 'confirm your age'])) {
    return new WaveyError('yt_age', st)
  }
  if (includesAny(msg, ['not available in your country', 'region', 'geo'])) {
    return new WaveyError('yt_region', st)
  }
  if (includesAny(msg, ['private', 'login required', 'not playable'])) {
    if (includesAny(msg, ['instagram', 'reel', 'story'])) {
      return new WaveyError('ig_private', st)
    }
    return new WaveyError('yt_private', st)
  }
  if (includesAny(msg, ['no valid url to decipher', 'decipher', 'yt_cookie'])) {
    return new WaveyError('yt_decipher', st)
  }
  if (includesAny(msg, ['youtube', 'innertube', 'no streams', 'streaming'])) {
    return new WaveyError('yt_unavailable', st)
  }

  if (includesAny(msg, ['ig_sessionid', 'stories need', 'session cookie'])) {
    return new WaveyError('ig_story_auth', st)
  }
  if (includesAny(msg, ['expired', 'fresher session', 'story'])) {
    if (includesAny(msg, ['story'])) return new WaveyError('ig_expired', st)
  }
  if (includesAny(msg, ['instagram', 'could not resolve', 'could not extract'])) {
    return new WaveyError('ig_not_found', st)
  }

  if (includesAny(msg, ['image, not a video', 'photo'])) {
    return new WaveyError('image_not_video', st)
  }
  if (includesAny(msg, ['encode', 'ffmpeg', 'mp3 encode'])) {
    return new WaveyError('encode_fail', st)
  }
  if (includesAny(msg, ['download', 'upstream', 'stream failed'])) {
    return new WaveyError('download_fail', st)
  }
  if (includesAny(msg, ['clipboard'])) {
    return new WaveyError('clipboard', st)
  }
  if (includesAny(msg, ['share cancelled', 'abort'])) {
    return new WaveyError('share_cancel', st)
  }
  if (includesAny(msg, ['share sheet'])) {
    return new WaveyError('share_unsupported', st)
  }

  return new WaveyError('generic', st, raw.slice(0, 120))
}

function guessStatus(msg: string): number | undefined {
  const m = msg.match(/\b([45]\d\d)\b/)
  return m ? Number(m[1]) : undefined
}

export function friendlyFromUnknown(err: unknown, status?: number): FriendlyError {
  return toWaveyError(err, status).toFriendly()
}
