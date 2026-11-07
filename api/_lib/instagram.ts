import { isInstagramStory, sanitizeFilename } from './validate.js'

export type IgResolved = {
  platform: 'instagram'
  title: string
  creator: string
  duration: string
  durationSec: number
  thumbUrl: string | null
  thumbHue: number
  kindLabel: 'Reel' | 'Story' | 'Post'
  sourceUrl: string
  isStory: boolean
  mediaUrl: string
  mimeType: string
  filename: string
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function igCookies(): string | undefined {
  const session = process.env.IG_SESSIONID?.trim()
  if (!session) return undefined
  const parts = [`sessionid=${session}`]
  if (process.env.IG_DS_USER_ID) parts.push(`ds_user_id=${process.env.IG_DS_USER_ID}`)
  if (process.env.IG_CSRFTOKEN) parts.push(`csrftoken=${process.env.IG_CSRFTOKEN}`)
  return parts.join('; ')
}

function parseShortcode(url: URL): { kind: 'reel' | 'story' | 'post'; code?: string; user?: string; storyId?: string } {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'reel' || parts[0] === 'reels') {
    return { kind: 'reel', code: parts[1] }
  }
  if (parts[0] === 'p' || parts[0] === 'tv') {
    return { kind: 'post', code: parts[1] }
  }
  if (parts[0] === 'stories' || parts[0] === 'story') {
    return { kind: 'story', user: parts[1], storyId: parts[2] }
  }
  return { kind: 'post', code: parts[1] }
}

function extractFromHtml(html: string): {
  videoUrl?: string
  imageUrl?: string
  title?: string
  username?: string
} {
  // og tags
  const ogVideo =
    html.match(/property="og:video(?::secure_url)?"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:video(?::secure_url)?"/i)?.[1]
  const ogImage =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1]
  const ogTitle =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1]

  // JSON blobs Instagram embeds in page
  const videoUrlMatch =
    html.match(/"video_url":"([^"]+)"/)?.[1] ||
    html.match(/"contentUrl":"(https:[^"]+\.mp4[^"]*)"/)?.[1]
  const usernameMatch = html.match(/"username":"([^"]+)"/)?.[1]

  const decode = (s?: string) =>
    s ? s.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\"/g, '"') : undefined

  return {
    videoUrl: decode(ogVideo || videoUrlMatch),
    imageUrl: decode(ogImage),
    title: ogTitle ? decodeURIComponent(ogTitle.replace(/&amp;/g, '&')) : undefined,
    username: usernameMatch,
  }
}

async function fetchEmbed(url: string): Promise<{
  videoUrl?: string
  imageUrl?: string
  title?: string
  username?: string
}> {
  const embedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`
  try {
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string
        author_name?: string
        thumbnail_url?: string
      }
      return {
        title: data.title,
        username: data.author_name,
        imageUrl: data.thumbnail_url,
      }
    }
  } catch {
    // fall through
  }
  return {}
}

async function fetchStoryMedia(url: URL): Promise<{
  videoUrl?: string
  imageUrl?: string
  username?: string
}> {
  const cookies = igCookies()
  if (!cookies) {
    throw new Error(
      'Instagram stories need IG_SESSIONID set in Vercel env (and optionally IG_DS_USER_ID / IG_CSRFTOKEN)',
    )
  }

  const parsed = parseShortcode(url)
  const username = parsed.user
  if (!username) throw new Error('Could not parse story username from URL')

  // Public story permalink page with session cookie
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': UA,
      Cookie: cookies,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.instagram.com/',
    },
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(`Story fetch failed (${res.status}). Cookie may be expired or story private/gone.`)
  }

  const html = await res.text()
  const extracted = extractFromHtml(html)
  if (!extracted.videoUrl && !extracted.imageUrl) {
    // Try GraphQL-ish media from shared data
    const mediaMatch = html.match(/"video_versions":\[\{"url":"([^"]+)"/)
    if (mediaMatch?.[1]) {
      extracted.videoUrl = mediaMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/')
    }
  }
  if (!extracted.videoUrl && !extracted.imageUrl) {
    throw new Error('Could not extract story media. It may have expired or require a fresher session.')
  }
  return { ...extracted, username: extracted.username || username }
}

export async function resolveInstagram(sourceUrl: string): Promise<IgResolved> {
  const url = new URL(sourceUrl)
  const story = isInstagramStory(url)
  const parsed = parseShortcode(url)

  let videoUrl: string | undefined
  let imageUrl: string | undefined
  let title: string | undefined
  let username: string | undefined

  if (story) {
    const storyMedia = await fetchStoryMedia(url)
    videoUrl = storyMedia.videoUrl
    imageUrl = storyMedia.imageUrl
    username = storyMedia.username
    title = username ? `${username}'s story` : 'Instagram story'
  } else {
    const pageRes = await fetch(url.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })

    const embed = await fetchEmbed(url.toString())
    title = embed.title
    username = embed.username
    imageUrl = embed.imageUrl

    if (pageRes.ok) {
      const html = await pageRes.text()
      const extracted = extractFromHtml(html)
      videoUrl = extracted.videoUrl
      imageUrl = imageUrl || extracted.imageUrl
      title = title || extracted.title
      username = username || extracted.username
    }

    // ddinstagram / embed fallback for public reels when IG HTML is login-walled
    if (!videoUrl) {
      const short = parsed.code
      if (short) {
        const mirrors = [
          `https://www.ddinstagram.com/reel/${short}/`,
          `https://www.ddinstagram.com/p/${short}/`,
        ]
        for (const mirror of mirrors) {
          try {
            const mres = await fetch(mirror, {
              headers: { 'User-Agent': UA, Accept: 'text/html' },
              redirect: 'follow',
            })
            if (!mres.ok) continue
            const mhtml = await mres.text()
            const mex = extractFromHtml(mhtml)
            if (mex.videoUrl) {
              videoUrl = mex.videoUrl
              imageUrl = imageUrl || mex.imageUrl
              title = title || mex.title
              username = username || mex.username
              break
            }
          } catch {
            // try next
          }
        }
      }
    }
  }

  if (!videoUrl && !imageUrl) {
    throw new Error(
      story
        ? 'Could not resolve story media'
        : 'Could not resolve Instagram media. Only public reels/posts work without login.',
    )
  }

  const mediaUrl = videoUrl || imageUrl!
  const mimeType = videoUrl ? 'video/mp4' : 'image/jpeg'
  const kindLabel = story ? 'Story' : parsed.kind === 'reel' ? 'Reel' : 'Post'
  const creator = username ? (username.startsWith('@') ? username : `@${username}`) : '@instagram'
  const safeTitle = title || (story ? 'Instagram story' : 'Instagram reel')
  const ext = videoUrl ? 'mp4' : 'jpg'

  return {
    platform: 'instagram',
    title: safeTitle,
    creator,
    duration: story ? '0:15' : '—',
    durationSec: 0,
    thumbUrl: imageUrl || null,
    thumbHue: story ? 300 : 320,
    kindLabel,
    sourceUrl,
    isStory: story,
    mediaUrl,
    mimeType,
    filename: `${sanitizeFilename(safeTitle)}.${ext}`,
  }
}

export function igFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: 'https://www.instagram.com/',
  }
  const cookies = igCookies()
  if (cookies) headers.Cookie = cookies
  return headers
}
