/** Silence graph initialization; open smoothly once a playable preset is ready. */
export class StartupGate {
  readonly node: GainNode;
  private opened = false;
  constructor(private context: BaseAudioContext) {
    this.node = context.createGain();
    this.node.gain.value = 0;
  }
  open(): void {
    if (this.opened) return;
    this.opened = true;
    const time = this.context.currentTime;
    this.node.gain.cancelScheduledValues(time);
    this.node.gain.setValueAtTime(0, time);
    this.node.gain.setValueAtTime(0, time + 0.03);
    this.node.gain.linearRampToValueAtTime(1, time + 0.11);
  }
  /** Only used while the context is suspended/closed, never to cut live tails. */
  suspend(): void {
    this.opened = false;
    this.node.gain.cancelScheduledValues(this.context.currentTime);
    this.node.gain.setValueAtTime(0, this.context.currentTime);
  }
  dispose(): void { this.node.disconnect(); }
}
