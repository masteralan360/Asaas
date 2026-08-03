import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveHintVideoUrl } from './hintVideoUrl'

/**
 * YouTube-style thumbnail: extracts a frame from the video itself via an
 * offscreen <video> + canvas, so no separate image asset is needed.
 */
export function VideoThumbnail({ src, className }: { src: string; className?: string }) {
    const [thumbnail, setThumbnail] = useState<string | null>(null)
    const cancelledRef = useRef(false)

    useEffect(() => {
        cancelledRef.current = false
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = resolveHintVideoUrl(src)

        const capture = () => {
            if (cancelledRef.current || video.readyState < 2) return
            try {
                const canvas = document.createElement('canvas')
                canvas.width = video.videoWidth || 640
                canvas.height = video.videoHeight || 360
                const context = canvas.getContext('2d')
                if (!context) return
                context.drawImage(video, 0, 0, canvas.width, canvas.height)
                const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
                if (!cancelledRef.current) setThumbnail(dataUrl)
            } catch {
                // Frame extraction is best-effort; the placeholder stays.
            }
        }

        const trySeekForFrame = () => {
            try {
                if (video.readyState >= 2) {
                    const target = Math.min(0.5, Math.max(0, (video.duration ?? 0) - 0.15))
                    video.currentTime = target
                }
            } catch {
                // Ignore seek failures; the fallback timer still fires.
            }
        }

        video.onloadeddata = trySeekForFrame
        video.onseeked = capture
        video.onerror = () => {
            // Nothing to do: the placeholder remains visible.
        }
        video.load()

        const fallbackTimer = setTimeout(() => {
            if (!cancelledRef.current) capture()
        }, 3000)

        return () => {
            cancelledRef.current = true
            if (fallbackTimer) clearTimeout(fallbackTimer)
            video.src = ''
            video.onloadeddata = null
            video.onseeked = null
            video.onerror = null
        }
    }, [src])

    return (
        <div
            className={cn(
                'relative aspect-video w-full overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-black',
                className
            )}
        >
            {thumbnail ? (
                <img
                    src={thumbnail}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
                </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="pointer-events-none flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-xl ring-4 ring-black/20 transition-transform">
                    <Play className="ms-1 h-6 w-6 fill-foreground text-foreground" />
                </span>
            </div>
        </div>
    )
}
