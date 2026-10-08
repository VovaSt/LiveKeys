import { expect, it, vi } from 'vitest';
import { SampleVoice } from '../../src/audio-web/voice';
import type { PadParameters } from '../../src/domain/models';

function voice(pitch = 60, pad?: PadParameters) {
  const gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn(), setTargetAtTime: vi.fn() };
  const envelope = { gain, connect: vi.fn() };
  const source = { playbackRate: { value: 1 }, connect: vi.fn((node: unknown) => node), start: vi.fn(), stop: vi.fn() };
  const context = { createGain: () => envelope, createBufferSource: () => source, sampleRate: 48000,
    createBiquadFilter: () => ({ Q: { value: 0 }, frequency: { value: 0 }, connect: () => envelope }) };
  const result = new SampleVoice(context as unknown as BaseAudioContext, {} as AudioNode, {} as AudioBuffer,
    { id: 'test', url: '', rootNote: 60, keyRange: [0, 127], velocityRange: [1, 127], tuningCents: 0, gainDb: 0 }, pitch, 100, 0, 0, pad);
  for (const method of Object.values(gain)) method.mockClear();
  return { result, gain, source };
}
it('piano uses a bounded exponential damper tail, with longer bass release', () => {
  const { result, gain, source } = voice();
  result.release(2);
  expect(gain.cancelAndHoldAtTime).toHaveBeenCalledWith(2);
  expect(gain.setTargetAtTime).toHaveBeenCalledWith(0, 2, 1.05 / 7);
  expect(gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  expect(source.stop).toHaveBeenCalledWith(2 + 1.05 + 0.001);
  expect(voice(36).result.releaseDuration).toBeGreaterThan(voice(84).result.releaseDuration);
  result.release(2.2);
  expect(source.stop).toHaveBeenCalledTimes(1);
});
it('Panic overrides a piano tail with a fast release', () => {
  const { result, gain, source } = voice();
  result.release(2); result.release(2.1, true);
  expect(result.releaseDuration).toBe(0.008);
  expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 2.1 + 0.008);
  expect(source.stop).toHaveBeenLastCalledWith(2.1 + 0.008 + 0.001);
});
it('pad release and explicit half-second voice stealing retain their envelopes', () => {
  const pad = voice(60, { attack: 0.7, release: 2, cutoff: 400, movement: 0 });
  pad.result.release(1);
  expect(pad.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3);
  const stolen = voice(); stolen.result.release(1, true, 0.5);
  expect(stolen.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.5);
  expect(stolen.gain.setTargetAtTime).not.toHaveBeenCalled();
});
