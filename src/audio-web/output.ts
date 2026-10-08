/** Speakers downmix averages L/R, then duplicates mono into the stereo output. */
export class OutputGraph {
  private stereo: GainNode; private mono: GainNode;
  constructor(private context: BaseAudioContext, input: AudioNode, output: AudioNode, mono: boolean) {
    this.stereo = context.createGain(); this.mono = context.createGain();
    this.mono.channelCount = 1; this.mono.channelCountMode = 'explicit'; this.mono.channelInterpretation = 'speakers';
    this.stereo.gain.value = mono ? 0 : 1; this.mono.gain.value = mono ? 1 : 0;
    input.connect(this.stereo).connect(output); input.connect(this.mono).connect(output);
  }
  setMono(mono: boolean): void {
    this.stereo.gain.setTargetAtTime(mono ? 0 : 1, this.context.currentTime, 0.015);
    this.mono.gain.setTargetAtTime(mono ? 1 : 0, this.context.currentTime, 0.015);
  }
  dispose(): void { this.stereo.disconnect(); this.mono.disconnect(); }
}
