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
        // Soft, gentle low-frequency double-damped tone (sine wave, warm and unobtrusive)
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(220, now)
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.18)
        gain.gain.setValueAtTime(0.001, now)
        gain.gain.linearRampToValueAtTime(0.05, now + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.20)
      } else if (type === 'interactive') {
        // Soft warm two-tone chime (F4 -> C5, gentle marimba/bell tone)
        const playTone = (freq: number, startTime: number, duration: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, startTime)
          gain.gain.setValueAtTime(0.001, startTime)
          gain.gain.linearRampToValueAtTime(0.06, startTime + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(startTime)
          osc.stop(startTime + duration)
        }
        playTone(349.23, now, 0.22)
        playTone(523.25, now + 0.1, 0.32)
      } else if (type === 'completion') {
        // Soft, warm ascending triad arpeggio (E4 -> G4 -> C5)
        const notes = [329.63, 392.00, 523.25]
        notes.forEach((freq, idx) => {
          const startTime = now + idx * 0.09
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, startTime)
          gain.gain.setValueAtTime(0.001, startTime)
          gain.gain.linearRampToValueAtTime(0.05, startTime + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.26)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(startTime)
          osc.stop(startTime + 0.26)
        })
      } else if (type === 'step') {
        // Very subtle, gentle soft micro-tap on milestone progression
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(440, now)
        osc.frequency.exponentialRampToValueAtTime(260, now + 0.04)
        gain.gain.setValueAtTime(0.001, now)
        gain.gain.linearRampToValueAtTime(0.02, now + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.045)
      }
    } catch {
      // Audio errors are silently handled to prevent interruption
    }
  }
}

export const soundEffectsService = new SoundEffectsService()
