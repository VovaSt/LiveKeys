/** Telemetry only. Clock drift detects stalls, not CPU utilization. */
export class AudioLoadMonitor {
  private previous?: { wall: number; audio: number };
  private underruns?: number;
  private warningUntil = 0;
  sample(wall: number, audio: number, running: boolean, visible: boolean, underruns?: number): { audioOverloaded: boolean; audioLoadSource: 'playback' | 'estimate' } {
    const source = underruns === undefined ? 'estimate' : 'playback';
    if (!running || !visible) {
      this.previous = undefined; this.underruns = underruns; this.warningUntil = 0;
      return { audioOverloaded: false, audioLoadSource: source };
    }
    if (underruns !== undefined && this.underruns !== undefined && underruns > this.underruns) this.warningUntil = wall + 2000;
    this.underruns = underruns;
    const previous = this.previous;
    if (!previous) this.previous = { wall, audio };
    else if (wall - previous.wall >= 250) {
      const elapsed = wall - previous.wall;
      // Skip background/main-thread pauses; normal render-quantum jitter is well below 50 ms.
      if (source === 'estimate' && elapsed < 1000 && elapsed - (audio - previous.audio) * 1000 > 50) this.warningUntil = wall + 2000;
      this.previous = { wall, audio };
    }
    return { audioOverloaded: wall < this.warningUntil, audioLoadSource: source };
  }
}
