export const HOLD_FEEDBACK_MIN_FREQUENCY_HZ = 440
export const HOLD_FEEDBACK_MAX_FREQUENCY_HZ = 1320
export const HOLD_FEEDBACK_VOLUME = 0.08

export function getHoldFeedbackFrequency(
    progress: number,
    minFrequencyHz = HOLD_FEEDBACK_MIN_FREQUENCY_HZ,
    maxFrequencyHz = HOLD_FEEDBACK_MAX_FREQUENCY_HZ
): number {
    if (
        !Number.isFinite(minFrequencyHz) ||
        !Number.isFinite(maxFrequencyHz) ||
        minFrequencyHz <= 0 ||
        maxFrequencyHz <= minFrequencyHz
    ) {
        return HOLD_FEEDBACK_MIN_FREQUENCY_HZ
    }
    const ratio = Math.min(100, Math.max(0, progress)) / 100
    return minFrequencyHz * Math.pow(maxFrequencyHz / minFrequencyHz, ratio)
}

let audioContext: AudioContext | null = null
let oscillator: OscillatorNode | null = null
let gainNode: GainNode | null = null
let isHolding = false

function resolveAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (audioContext) {
        if (audioContext.state === 'suspended') void audioContext.resume()
        return audioContext
    }
    const AudioContextCtor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return null
    audioContext = new AudioContextCtor()
    return audioContext
}

function playTone(
    ctx: AudioContext,
    frequency: number,
    startOffsetMs: number,
    durationMs: number,
    toneVolume: number
): void {
    const startAt = ctx.currentTime + startOffsetMs / 1000
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, startAt)
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(toneVolume, startAt + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(startAt)
    osc.stop(startAt + durationMs / 1000 + 0.05)
    osc.addEventListener('ended', () => {
        osc.disconnect()
        gain.disconnect()
    })
}

export function startHoldFeedback(progress = 0): void {
    const ctx = resolveAudioContext()
    if (!ctx) return
    stopHoldFeedback()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(getHoldFeedbackFrequency(progress), ctx.currentTime)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(HOLD_FEEDBACK_VOLUME, ctx.currentTime + 0.02)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    oscillator = osc
    gainNode = gain
    isHolding = true
}

export function updateHoldFeedback(progress: number): void {
    if (!isHolding) return
    const ctx = audioContext
    const osc = oscillator
    if (!ctx || !osc) return
    const frequency = getHoldFeedbackFrequency(progress)
    const at = ctx.currentTime
    osc.frequency.cancelScheduledValues(at)
    osc.frequency.setValueAtTime(Math.max(0.01, osc.frequency.value), at)
    osc.frequency.exponentialRampToValueAtTime(frequency, at + 0.03)
}

export function stopHoldFeedback(): void {
    if (!isHolding) return
    isHolding = false
    const ctx = audioContext
    const osc = oscillator
    const gain = gainNode
    oscillator = null
    gainNode = null
    if (!ctx || !osc || !gain) return
    const at = ctx.currentTime
    gain.gain.cancelScheduledValues(at)
    gain.gain.setValueAtTime(gain.gain.value, at)
    gain.gain.linearRampToValueAtTime(0, at + 0.04)
    osc.stop(at + 0.06)
    osc.addEventListener('ended', () => {
        osc.disconnect()
        gain.disconnect()
    })
}

export function playHoldFeedbackComplete(): void {
    stopHoldFeedback()
    const ctx = resolveAudioContext()
    if (!ctx) return
    const peak = getHoldFeedbackFrequency(100)
    playTone(ctx, peak, 0, 0.14, HOLD_FEEDBACK_VOLUME)
    playTone(ctx, peak * 1.5, 90, 0.18, HOLD_FEEDBACK_VOLUME * 0.8)
}