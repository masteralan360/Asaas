export function buildWorkflowGradientFill(segments: Array<{ reached: boolean; color: string }>) {
    const reachedSegments = segments.filter((segment) => segment.reached)
    const reached = Math.max(1, reachedSegments.length)
    const span = Math.min(reached + 1, segments.length)
    const seg = 100 / span
    const blend = 4

    const stops: string[] = []
    for (let i = 0; i < reached - 1; i++) {
        const end = (i + 1) * seg
        stops.push(`${reachedSegments[i].color} ${i * seg}%`)
        stops.push(`${reachedSegments[i].color} ${end - blend}%`)
        stops.push(`${reachedSegments[i + 1].color} ${end + blend}%`)
    }
    const lastReached = reachedSegments[reached - 1]
    stops.push(`${lastReached.color} ${Math.min(100, (reached - 1) * seg + blend)}%`)
    stops.push(`${lastReached.color} ${Math.max(0, reached * seg - blend)}%`)
    stops.push(`${(segments[reached] ?? lastReached).color} 100%`)

    return {
        width: Math.round((reached / segments.length) * 100),
        background: `linear-gradient(90deg, ${stops.join(', ')})`,
        backgroundSize: `${(span / reached) * 100}% 100%`
    }
}