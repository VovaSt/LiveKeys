import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebMidiService } from '../../src/midi-web/service';
import type { NoteRouter } from '../../src/domain/router';
afterEach(() => vi.unstubAllGlobals());
describe('Web MIDI adapter', () => {
  it('requests no SysEx, selects multiple inputs, removes disconnected listeners and requires reselection', async () => {
    const input = (id: string) => ({ id, name: id, manufacturer: 'Test', state: 'connected', onmidimessage: null });
    const a = input('a') as unknown as MIDIInput;
    const b = input('b') as unknown as MIDIInput;
    const access = { inputs: new Map([['a', a], ['b', b]]), onstatechange: null as null | (() => void) };
    const request = vi.fn(async () => access);
    vi.stubGlobal('navigator', { requestMIDIAccess: request }); vi.stubGlobal('window', { isSecureContext: true });
    const router = { handle: vi.fn(), clearInput: vi.fn() };
    const disconnected = vi.fn();
    const service = new WebMidiService(router as unknown as NoteRouter, t => t / 1000, vi.fn(), disconnected);
    await service.connect(); expect(request).toHaveBeenCalledWith({ sysex: false });
    service.select('a', true); service.select('b', true);
    a.onmidimessage?.call(a, { data: new Uint8Array([0x90, 60, 100]), timeStamp: 1000 } as MIDIMessageEvent);
    expect(router.handle).toHaveBeenCalledWith({ type: 'on', input: 'a', channel: 1, note: 60, velocity: 100, time: 1 });
    Object.assign(a, { state: 'disconnected' }); access.onstatechange?.();
    expect(a.onmidimessage).toBeNull(); expect(b.onmidimessage).not.toBeNull();
    expect(router.clearInput).toHaveBeenCalledWith('a', expect.any(Number)); expect(disconnected).toHaveBeenCalledWith('a');
    Object.assign(a, { state: 'connected' }); access.onstatechange?.();
    expect(service.inputs().find(i => i.id === 'a')?.selected).toBe(false);
    service.select('a', true); expect(a.onmidimessage).not.toBeNull();
    service.dispose(); expect(a.onmidimessage).toBeNull(); expect(b.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });
  it('rejects unsupported and denied access without throwing from dispose', async () => {
    vi.stubGlobal('window', { isSecureContext: true }); vi.stubGlobal('navigator', {});
    const service = new WebMidiService({} as NoteRouter, () => 0, vi.fn(), vi.fn());
    await expect(service.connect()).rejects.toThrow('MIDI_UNSUPPORTED');
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.reject(new Error('denied')) });
    await expect(service.connect()).rejects.toThrow('denied'); expect(() => service.dispose()).not.toThrow();
  });
});
