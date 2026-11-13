/**
 * Zero-dependency Web Audio synthesizer for pleasant micro-interaction sound feedback.
 * Synthesizes pure tones via AudioContext, requiring no external mp3/wav network downloads.
 */

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioCtx) return null
  try {
    return new AudioCtx()
  } catch {
    return null
  }
}

/**
 * Cheerful two-tone chime for instant positive feedback on approval.
 */
export function playApprovalChime(): void {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // Note 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(587.33, now)

    gain1.gain.setValueAtTime(0.12, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)

    osc1.start(now)
    osc1.stop(now + 0.25)

    // Note 2: A5 (880.00 Hz) - slightly delayed
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(880, now + 0.08)

    gain2.gain.setValueAtTime(0.15, now + 0.08)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)

    osc2.start(now + 0.08)
    osc2.stop(now + 0.38)
  } catch {
    // Graceful fallback when audio is blocked or muted
  }
}

/**
 * Soft subtle note for dismiss/skip action.
 */
export function playDismissSound(): void {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(329.63, now) // E4
    osc.frequency.exponentialRampToValueAtTime(261.63, now + 0.15) // slide down to C4

    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.18)
  } catch {
    // Graceful fallback
  }
}
