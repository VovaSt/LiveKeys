import type { AudioEngine } from './contracts';
import type { MidiMessage, PerformancePreset, VoiceIdentity } from './models';
import { audibleLayers, curveVelocity } from './layers';
interface HeldVoice { identity: VoiceIdentity; held: boolean; sustained: boolean; sustainEnabled: boolean; mono: boolean; velocity: number; playing?: string }
const scopeKey = (input: string, channel: number): string => JSON.stringify([input, channel]);

/** No DOM, Angular, or timers. Repeated key presses are paired FIFO with note-offs. */
export class NoteRouter {
  private serial = 0;
  private transpose = 0;
  private voices = new Map<string, HeldVoice>();
  private pedals = new Set<string>();
  // Tombstones retain FIFO identity after voice stealing/natural completion.
  private presses = new Map<string, string[][]>();
  constructor(private engine: AudioEngine, private preset: PerformancePreset, private instance: string) {
    engine.onVoiceEnded = id => {
      for (const [key, voice] of this.voices) if (voice.playing === id) { this.voices.delete(key); break; }
    };
  }
  activate(preset: PerformancePreset, instance: string): void { this.preset = preset; this.instance = instance; }
  setGlobalTranspose(value: number): void {
    if (Number.isInteger(value) && value >= -12 && value <= 12) this.transpose = value;
  }
  updatePreset(preset: PerformancePreset, time: number): void {
    const audible = audibleLayers(preset);
    for (const [id, voice] of this.voices) {
      if (voice.identity.presetInstance !== this.instance) continue;
      const layer = audible.find(l => l.id === voice.identity.layer);
      const previous = this.preset.layers.find(l => l.id === voice.identity.layer);
      if (!layer || layer.instrument.id !== previous?.instrument.id || layer.instrument.version !== previous?.instrument.version || layer.mono !== previous?.mono) {
        this.stop(voice, time, true); this.voices.delete(id);
      } else if (!layer.sustainEnabled && voice.sustainEnabled) {
        voice.sustainEnabled = false;
        if (voice.sustained && !voice.held) { voice.sustained = false; this.release(voice, time); }
      }
    }
    this.preset = preset;
  }
  get heldNotes(): number[] { return [...this.voices.values()].filter(v => v.held).map(v => v.identity.note); }
  get sustainCount(): number { return this.pedals.size; }
  handle(message: MidiMessage): void {
    if (message.type === 'on') this.on(message);
    else if (message.type === 'off') this.off(message);
    else if (message.type === 'cc') this.control(message);
    else this.engine.controlChange(message);
  }
  private on(m: Extract<MidiMessage, { type: 'on' | 'off' }>): void {
    if (m.velocity === 0) { this.off(m); return; }
    const ids: string[] = [];
    for (const layer of audibleLayers(this.preset)) {
      if (
        m.note < layer.keyRange[0] || m.note > layer.keyRange[1] ||
        m.velocity < layer.velocityRange[0] || m.velocity > layer.velocityRange[1] ||
        (layer.channel !== 'omni' && layer.channel !== m.channel) ||
        (layer.inputs.length > 0 && !layer.inputs.includes(m.input))) continue;
      const pitch = m.note + this.transpose + (layer.octave ?? 0) * 12;
      if (pitch < 0 || pitch > 127) continue;
      const identity: VoiceIdentity = { id: String(++this.serial), input: m.input, channel: m.channel,
        note: m.note, pitch, layer: layer.id, presetInstance: this.instance };
      const velocity = curveVelocity(m.velocity, layer.velocityCurve);
      const voice: HeldVoice = { identity, held: true, sustained: false, sustainEnabled: layer.sustainEnabled, mono: layer.mono, velocity };
      if (layer.mono) {
        this.voices.set(identity.id, voice); this.reconcile(voice, m.time);
        if (this.voices.has(identity.id)) ids.push(identity.id);
      } else if (this.engine.noteOn(identity, velocity, m.time)) {
        voice.playing = identity.id; this.voices.set(identity.id, voice); ids.push(identity.id);
      }
    }
    const key = JSON.stringify([m.input, m.channel, m.note]);
    const queue = this.presses.get(key) ?? [];
    // Bound malformed streams with missing note-offs, preserving ordinary repeated notes.
    if (queue.length >= 128) {
      for (const id of queue.shift() ?? []) { const voice = this.voices.get(id); if (voice) this.stop(voice, m.time, true); this.voices.delete(id); }
    }
    queue.push(ids); this.presses.set(key, queue);
  }
  private off(m: Extract<MidiMessage, { type: 'on' | 'off' }>): void {
    const key = JSON.stringify([m.input, m.channel, m.note]);
    const queue = this.presses.get(key);
    for (const id of queue?.shift() ?? []) {
      const voice = this.voices.get(id);
      if (!voice) continue;
      voice.held = false;
      voice.sustained = voice.sustainEnabled && this.pedals.has(scopeKey(m.input, m.channel));
      if (voice.mono || !voice.sustained) this.release(voice, m.time);
    }
    if (queue?.length === 0) this.presses.delete(key);
  }
  private stop(voice: HeldVoice, time: number, fast = false): void {
    const playing = voice.playing; voice.playing = undefined;
    if (playing) this.engine.noteOff(playing, time, fast);
  }
  private release(voice: HeldVoice, time: number): void {
    if (voice.mono) this.reconcile(voice, time);
    else if (voice.playing) this.engine.noteOff(voice.playing, time);
  }
  private reconcile(scope: HeldVoice, time: number): void {
    const group = [...this.voices.values()].filter(v => v.mono && v.identity.layer === scope.identity.layer && v.identity.presetInstance === scope.identity.presetInstance);
    const held = group.filter(v => v.held);
    const chosen = (held.length ? held : group.filter(v => v.sustained)).at(-1);
    const current = group.find(v => v.playing);
    if (chosen !== current) {
      if (current) this.stop(current, time, !!chosen);
      if (chosen) {
        const playing = String(++this.serial);
        const identity = { ...chosen.identity, id: playing, glideFrom: current?.identity.pitch };
        if (this.engine.noteOn(identity, chosen.velocity, time)) chosen.playing = playing;
        else this.voices.delete(chosen.identity.id);
      }
    }
    for (const voice of group) if (!voice.held && !voice.sustained && !voice.playing) this.voices.delete(voice.identity.id);
  }
  private control(m: Extract<MidiMessage, { type: 'cc' }>): void {
    const scope = scopeKey(m.input, m.channel);
    if (m.controller === 64) {
      if (m.value >= 64) this.pedals.add(scope);
      else {
        this.pedals.delete(scope);
        for (const v of this.voices.values()) {
          if (scopeKey(v.identity.input, v.identity.channel) === scope && v.sustained && !v.held) {
            v.sustained = false; this.release(v, m.time);
          }
        }
      }
    } else if (m.controller === 120) this.clearInput(m.input, m.time, m.channel);
    else if (m.controller === 123) {
      // All Notes Off behaves like key releases and therefore respects sustain.
      for (const [key, queue] of [...this.presses]) {
        const [input, channel, note] = JSON.parse(key) as [string, number, number];
        if (input === m.input && channel === m.channel) {
          const count = queue.length;
          for (let i = 0; i < count; i++) this.off({ ...m, type: 'off', note, velocity: 0 });
        }
      }
    }
    this.engine.controlChange(m);
  }
  clearInput(input: string, time: number, channel?: number): void {
    this.engine.resetInput?.(input, channel);
    for (const [id, v] of this.voices) {
      if (v.identity.input === input && (channel === undefined || v.identity.channel === channel)) {
        this.stop(v, time, true); this.voices.delete(id);
      }
    }
    for (const key of this.pedals) {
      const [i, c] = JSON.parse(key) as [string, number];
      if (i === input && (channel === undefined || c === channel)) this.pedals.delete(key);
    }
    for (const key of this.presses.keys()) {
      const [i, c] = JSON.parse(key) as [string, number];
      if (i === input && (channel === undefined || c === channel)) this.presses.delete(key);
    }
  }
  panic(time: number): void {
    this.voices.clear(); this.pedals.clear(); this.presses.clear(); this.engine.panic(time);
  }
}
