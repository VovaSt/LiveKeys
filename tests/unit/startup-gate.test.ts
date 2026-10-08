import { expect, it, vi } from 'vitest';
import { StartupGate } from '../../src/audio-web/startup-gate';

it('starts silent, fades in once, and rearms after suspension without gating musical tails', () => {
  const gain = { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  const node = { gain, disconnect: vi.fn() };
  const context = { currentTime: 2, createGain: () => node };
  const gate = new StartupGate(context as unknown as BaseAudioContext);
  expect(gain.value).toBe(0);
  gate.open();
  expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 2.03);
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2.11);
  gate.open();
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  context.currentTime = 4; gate.suspend();
  expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 4);
  gate.open();
  expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 4.11);
  gate.dispose(); expect(node.disconnect).toHaveBeenCalledOnce();
});
