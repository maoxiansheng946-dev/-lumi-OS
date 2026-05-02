
/**
 * Procedural Audio Synthesis for Lumi OS
 * Generates technical sound effects using Web Audio API
 */
class SoundService {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, volume: number) {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  // Soft mechanical click for opening windows
  playClick() {
    this.playTone(800, 'sine', 0.1, 0.05);
    setTimeout(() => this.playTone(400, 'square', 0.05, 0.02), 50);
  }

  // Gentle pulse for theme changes
  playPulse() {
    this.playTone(200, 'sine', 0.5, 0.1);
  }

  // Success chime
  playSuccess() {
    this.playTone(600, 'sine', 0.1, 0.05);
    setTimeout(() => this.playTone(900, 'sine', 0.2, 0.05), 100);
  }

  // Neural trigger sound
  playNeural() {
    this.playTone(1200, 'triangle', 0.05, 0.03);
  }
}

export const sounds = new SoundService();
