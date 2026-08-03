#!/usr/bin/env node
/**
 * Optimizes tip videos that were dropped into public/tips.
 *
 * Any video larger than MAX_SIZE_BYTES is re-encoded with H.264 (CRF),
 * capped at 1080p, with faststart for web playback. The original file is
 * replaced only when the re-encode is at least MIN_SAVINGS_RATIO smaller.
 *
 * Run automatically before `npm run build` (see package.json "prebuild").
 * It is safe to run repeatedly: optimized files are recorded in
 * scripts/.optimized-tips.json (gitignored) and skipped on later runs.
 * Failures are non-fatal so a deploy is never blocked by a video.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    statSync,
    unlinkSync,
    renameSync,
    readdirSync
} from 'node:fs'

const require = createRequire(import.meta.url)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIPS_DIR = join(ROOT, 'public', 'tips')
const MARKER_FILE = join(ROOT, 'scripts', '.optimized-tips.json')
const MAX_SIZE_BYTES = 1.5 * 1024 * 1024
const MIN_SAVINGS_RATIO = 0.1
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv']
const TEMP_SUFFIX = '.tmp.mp4'

let ffmpegPath = null
try {
    const resolved = require('ffmpeg-static')
    if (resolved && existsSync(resolved)) ffmpegPath = resolved
} catch {
    // Fall through to PATH lookup below.
}
if (!ffmpegPath) {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
        ffmpegPath = 'ffmpeg'
    } catch {
        // No ffmpeg available anywhere; optimization will be skipped.
    }
}

function readMarker() {
    try {
        return JSON.parse(readFileSync(MARKER_FILE, 'utf8'))
    } catch {
        return {}
    }
}

function writeMarker(marker) {
    try {
        mkdirSync(dirname(MARKER_FILE), { recursive: true })
        writeFileSync(MARKER_FILE, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    } catch {
        // A missing marker only means the next run re-evaluates the videos.
    }
}

function formatBytes(bytes) {
    return bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(bytes / 1024).toFixed(0)} KB`
}

function replaceFile(tempPath, filePath) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            renameSync(tempPath, filePath)
            return true
        } catch (error) {
            if (attempt === 4) throw error
            // On Windows the original file may be briefly locked (Defender,
            // preview pane, media player). Retry before giving up.
            setTimeoutSync(500)
        }
    }
    return false
}

function setTimeoutSync(ms) {
    const end = Date.now() + ms
    while (Date.now() < end) {
        // Busy-wait: a short synchronous pause keeps the CLI flow simple.
    }
}

function optimizeFile(filePath, marker) {
    const name = filePath.slice(ROOT.length + 1).replace(/\\/g, '/')
    const tempPath = `${filePath}${TEMP_SUFFIX}`
    const inputSize = statSync(filePath).size

    try {
        execFileSync(ffmpegPath, [
            '-y',
            '-i', filePath,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '26',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-vf', "scale='min(1920,iw)':-2",
            '-c:a', 'aac',
            '-b:a', '96k',
            '-map', '0:v:0',
            '-map', '0:a?',
            tempPath
        ], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
        const detail = error.stderr?.toString().split('\n').find((line) => line.trim()) ?? error.message
        console.warn(`  ! ffmpeg failed for ${name}: ${detail}`)
        try {
            unlinkSync(tempPath)
        } catch {
            // Nothing to clean up.
        }
        return
    }

    const outputSize = statSync(tempPath).size
    if (outputSize >= inputSize * (1 - MIN_SAVINGS_RATIO)) {
        console.log(`  = ${name}: already optimized (${formatBytes(inputSize)})`)
        unlinkSync(tempPath)
        marker[name] = inputSize
        return
    }

    try {
        replaceFile(tempPath, filePath)
        marker[name] = outputSize
        console.log(`  ok ${name}: ${formatBytes(inputSize)} -> ${formatBytes(outputSize)} (${Math.round((1 - outputSize / inputSize) * 100)}% smaller)`)
    } catch {
        console.warn(`  ! could not replace ${name}: the file appears to be in use. It will be retried on the next run.`)
        try {
            unlinkSync(tempPath)
        } catch {
            // Nothing to clean up.
        }
    }
}

function main() {
    if (!existsSync(TIPS_DIR)) {
        console.log('[optimize-tips] public/tips does not exist, nothing to do.')
        return
    }

    const marker = readMarker()
    const candidates = readdirSync(TIPS_DIR)
        .filter((file) => !file.startsWith('.'))
        .filter((file) => !file.endsWith(TEMP_SUFFIX))
        .filter((file) => VIDEO_EXTENSIONS.includes(file.slice(file.lastIndexOf('.'))))
        .filter((file) => {
            const filePath = join(TIPS_DIR, file)
            const name = filePath.slice(ROOT.length + 1).replace(/\\/g, '/')
            return statSync(filePath).size > MAX_SIZE_BYTES && marker[name] !== statSync(filePath).size
        })

    if (candidates.length === 0) {
        console.log('[optimize-tips] all tip videos are already optimized.')
        return
    }

    if (!ffmpegPath) {
        console.warn('[optimize-tips] WARNING: ffmpeg is not available. Install it or run "npm i ffmpeg-static", then run "npm run optimize:tips". Skipping:')
        for (const file of candidates) {
            console.warn(`  - ${file}`)
        }
        return
    }

    console.log(`[optimize-tips] optimizing ${candidates.length} tip video(s)...`)
    for (const file of candidates) {
        optimizeFile(join(TIPS_DIR, file), marker)
    }

    writeMarker(marker)
}

main()
