import { Circle, Square, Star, Triangle, type LucideIcon } from 'lucide-react'

import type { PdfShapeKind } from '@/types'

export const PDF_SHAPE_OPTIONS: Array<{
    kind: PdfShapeKind
    label: string
    Icon: LucideIcon
}> = [
    { kind: 'rectangle', label: 'Square', Icon: Square },
    { kind: 'circle', label: 'Circle', Icon: Circle },
    { kind: 'triangle', label: 'Triangle', Icon: Triangle },
    { kind: 'star', label: 'Star', Icon: Star }
]

export function PdfShapeGraphic({ kind, color }: { kind: PdfShapeKind; color: string }) {
    return (
        <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="block h-full w-full"
            aria-hidden="true"
        >
            {kind === 'rectangle' && <rect width="100" height="100" fill={color} />}
            {kind === 'circle' && <circle cx="50" cy="50" r="50" fill={color} />}
            {kind === 'triangle' && <path d="M 50 0 L 100 100 L 0 100 Z" fill={color} />}
            {kind === 'star' && <path d="M 50 0 L 61.2 34.6 L 97.6 34.6 L 68.2 56 L 79.4 90.4 L 50 69 L 20.6 90.4 L 31.8 56 L 2.4 34.6 L 38.8 34.6 Z" fill={color} />}
        </svg>
    )
}
