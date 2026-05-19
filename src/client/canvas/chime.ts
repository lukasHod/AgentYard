/**
 * Tiny Web Audio-based chime player. No asset files required.
 * Muted state persists via localStorage; mute toggle lives in the HUD.
 */

const STORAGE_KEY = 'agentyard.audio.muted'

let ctx: AudioContext | null = null
let muted = false

if (typeof window !== 'undefined') {
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    muted = false
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  // Browsers start the context suspended until a user gesture. We optimistically
  // resume — if it fails (no gesture yet) the play will be a no-op and the next
  // call after the user clicks anything will succeed.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

function beep(c: AudioContext, freq: number, startAt: number, durationMs: number, gain: number): void {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startAt)
  g.gain.setValueAtTime(0, startAt)
  g.gain.linearRampToValueAtTime(gain, startAt + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000)
  osc.connect(g).connect(c.destination)
  osc.start(startAt)
  osc.stop(startAt + durationMs / 1000 + 0.05)
}

/** Two-note "incoming transmission" sting. */
export function playClarificationChime(): void {
  if (muted) return
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  beep(c, 880, now, 150, 0.08)
  beep(c, 660, now + 0.13, 220, 0.06)
}

export function isAudioMuted(): boolean {
  return muted
}

export function setAudioMuted(next: boolean): void {
  muted = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // ignore
    }
  }
}
