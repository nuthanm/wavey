import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = resolve(root, 'node_modules/@ffmpeg/core/dist/esm')
const destDir = resolve(root, 'public/ffmpeg')

if (!existsSync(resolve(srcDir, 'ffmpeg-core.wasm'))) {
  console.warn('[copy-ffmpeg] @ffmpeg/core not installed — skip')
  process.exit(0)
}

mkdirSync(destDir, { recursive: true })
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  copyFileSync(resolve(srcDir, name), resolve(destDir, name))
}
console.log('[copy-ffmpeg] public/ffmpeg ready')
