import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../../src/domain/contracts';
import { normalizeMidi } from '../../src/domain/midi';
import { pianoPreset, type MidiMessage, type VoiceIdentity } from '../../src/domain/models';
import { NoteRouter } from '../../src/domain/router';
function fixture() {
  const engine: AudioEngine = {
    init: async () => {}, resume: async () => {}, dispose: async () => {}, now: () => 0,
    preparePreset: async () => 'piano', activatePreparedPreset: () => {}, updatePreset: () => {},
    noteOn: vi.fn((_v: VoiceIdentity, _velocity: number, _time: number) => true),
    noteOff: vi.fn(), controlChange: vi.fn(), updateParameters: vi.fn(), panic: vi.fn(),
    diagnostics: () => ({ state: 'running', ready: true, voices: 0, nodes: 0, voiceLimit: 64,
      assets: 0, pcmBytes: 0, sampleRate: 48000, peakBefore: 0, peakAfter: 0 })
  };
  const router = new NoteRouter(engine, structuredClone(pianoPreset), 'first');
  const on = (note = 60, input = 'a', channel = 1, velocity = 100) => router.handle({ type: 'on', input, channel, note, velocity, time: 1 });
  const off = (note = 60, input = 'a', channel = 1) => router.handle({ type: 'off', input, channel, note, velocity: 0, time: 2 });
  const cc = (controller: number, value: number, input = 'a', channel = 1) => router.handle({ type: 'cc', input, channel, controller, value, time: 3 });
  return { engine, router, on, off, cc };
}
describe('MIDI normalization', () => {
  it('turns note-on zero into off and decodes all 16 channels', () => {
    expect(normalizeMidi([0x9f, 60, 0], 'a', 1)).toEqual({ type: 'off', note: 60, velocity: 0, input: 'a', channel: 16, time: 1 });
    expect(normalizeMidi([0x80, 60, 25], 'b', 2)?.type).toBe('off');
  });
  it.each([[0x90], [0x90, 60], [0x90, 128, 50], [0x90, 60, -1], [0xf0, 1, 2], [0xf8], [0x90, 1.5, 2]])('rejects invalid/system packets %s', (...data) => {
    expect(normalizeMidi(data, 'a', 1)).toBeUndefined();
  });
});
describe('voice identity and sustain', () => {
  it('pairs repeated note-ons FIFO, preserving sustained older voice', () => {
    const { on, off, cc, engine } = fixture();
    cc(64, 127); on(); on(); off(); expect(engine.noteOff).not.toHaveBeenCalled();
    cc(64, 0); expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('1', 3);
    off(); expect(engine.noteOff).toHaveBeenLastCalledWith('2', 2);
  });
  it('scopes pedal and CC120 by input/channel at the 63/64 boundary', () => {
    const { on, off, cc, engine, router } = fixture();
    cc(64, 64); on(); on(60, 'a', 2); on(60, 'b');
    off(); off(60, 'a', 2); off(60, 'b');
    expect(engine.noteOff).toHaveBeenCalledTimes(2);
    expect(router.sustainCount).toBe(1);
    cc(64, 63); expect(engine.noteOff).toHaveBeenLastCalledWith('1', 3);
  });
  it('CC123 respects sustain; CC120 kills sound and resets the scoped pedal', () => {
    const { on, cc, engine, router } = fixture();
    cc(64, 127); on(); cc(123, 0); expect(engine.noteOff).not.toHaveBeenCalled();
    cc(120, 0); expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('1', 3, true);
    expect(router.sustainCount).toBe(0);
  });
  it('disconnect leaves other inputs alive and clears pending repeats', () => {
    const { on, off, cc, router, engine } = fixture();
    on(); on(64, 'b'); cc(64, 127); cc(64, 127, 'b');
    router.clearInput('a', 5);
    expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('1', 5, true);
    expect(router.heldNotes).toEqual([64]); expect(router.sustainCount).toBe(1);
    on(); off(); expect(engine.noteOff).toHaveBeenLastCalledWith('3', 2);
  });
  it('note-off releases original pitch/instance after transpose and preset edit', () => {
    const { on, off, router, engine } = fixture();
    on(); const next = structuredClone(pianoPreset); next.layers[0]!.transpose = 12;
    router.setGlobalTranspose(12); router.activate(next, 'second'); on(); off();
    expect(engine.noteOff).toHaveBeenLastCalledWith('1', 2);
    expect(engine.noteOn).toHaveBeenNthCalledWith(1, expect.objectContaining({ pitch: 60, presetInstance: 'first' }), 100, 1);
    expect(engine.noteOn).toHaveBeenNthCalledWith(2, expect.objectContaining({ pitch: 72, presetInstance: 'second' }), 100, 1);
  });
  it('Panic is idempotent, clears pedal and accepts new notes immediately', () => {
    const { on, off, cc, router, engine } = fixture();
    on(); cc(64, 127); router.panic(4); router.panic(4);
    expect(router.heldNotes).toEqual([]); expect(router.sustainCount).toBe(0);
    on(); off(); expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('2', 2);
  });
  it('a stolen/naturally ended voice retains FIFO slot until its note-off', () => {
    const { on, off, engine } = fixture();
    on(); engine.onVoiceEnded?.('1'); on(); off(); expect(engine.noteOff).not.toHaveBeenCalled();
    off(); expect(engine.noteOff).toHaveBeenCalledExactlyOnceWith('2', 2);
  });
  it('rejecting notes before audio readiness does not create held voices', () => {
    const { on, off, engine, router } = fixture();
    vi.mocked(engine.noteOn).mockReturnValue(false); on(); off();
    expect(router.heldNotes).toEqual([]); expect(engine.noteOff).not.toHaveBeenCalled();
  });
  it('filters original key/velocity before transpose and rejects out-of-range pitches', () => {
    const { router, engine } = fixture();
    const p = structuredClone(pianoPreset); const l = p.layers[0]!;
    l.keyRange = [60, 72]; l.velocityRange = [40, 100]; l.transpose = 12;
    router.setGlobalTranspose(12); router.activate(p, 'range');
    for (const [note, velocity] of [[59, 50], [60, 39], [60, 40], [72, 100], [73, 100], [60, 101]])
      router.handle({ type: 'on', note, velocity, input: 'a', channel: 1, time: 0 } as MidiMessage);
    expect(engine.noteOn).toHaveBeenCalledTimes(2);
    expect(engine.noteOn).toHaveBeenNthCalledWith(2, expect.objectContaining({ pitch: 84 }), 100, 0);
    l.keyRange = [0, 127]; l.transpose = 24; router.activate(p, 'high');
    router.handle({ type: 'on', note: 120, velocity: 100, input: 'a', channel: 1, time: 0 });
    expect(engine.noteOn).toHaveBeenCalledTimes(2);
  });
});
