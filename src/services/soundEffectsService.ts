/**
 * src/services/soundEffectsService.ts
 *
 * Lightweight, zero-dependency audio feedback service built on the Web Audio API.
 * Synthesizes non-intrusive sound cues for agent execution events (errors, interactive prompts, completions).
 * Runs completely offline and requires 0 asset downloads.
 */

export type SoundEffectType = 'error' | 'interactive' | 'completion' | 'step'

export class SoundEffectsService {
  private audioCtx: AudioContext | null = null

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass()
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {})
    }
    return this.audioCtx
  }

  public play(type: SoundEffectType, enabled: boolean = true): void {
    if (!enabled) return
    try {
      const ctx = this.getAudioContext()
      if (!ctx) return

      const now = ctx.currentTime

      if (type === 'error') {
        // Subtle descending warning tone
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(320, now)
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.22)
        gain.gain.setValueAtTime(0.12, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.25)
      } else if (type === 'interactive') {
        // Pleasant two-tone bell chime (D5 -> A5)
        const playTone = (freq: number, startTime: number, duration: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, startTime)
          gain.gain.setValueAtTime(0.15, startTime)
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(startTime)
          osc.stop(startTime + duration)
        }
        playTone(587.33, now, 0.18)
        playTone(880.0, now + 0.1, 0.28)
      } else if (type === 'completion') {
        // Cheerful ascending major triad arpeggio (C5 -> E5 -> G5)
        const notes = [523.25, 659.25, 783.99]
        notes.forEach((freq, idx) => {
          const startTime = now + idx * 0.09
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, startTime)
          gain.gain.setValueAtTime(0.14, startTime)
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(startTime)
          osc.stop(startTime + 0.28)
        })
      } else if (type === 'step') {
        // Light subtle tick on milestone progression
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(800, now)
        gain.gain.setValueAtTime(0.04, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.05)
      }
    } catch {
      // Audio errors are silently handled to prevent interruption
    }
  }
}

export const soundEffectsService = new SoundEffectsService()
