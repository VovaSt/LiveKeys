import type { MidiMessage } from './models';
export function normalizeMidi(data: ArrayLike<number>, input: string, time: number): MidiMessage | undefined {
  const status = data[0]; const a = data[1]; const b = data[2];
  if (status === undefined || a === undefined || b === undefined ||
      !Number.isInteger(status) || status < 0x80 || status >= 0xf0 ||
      !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 127 || b < 0 || b > 127) return;
  const channel = (status & 15) + 1;
  switch (status & 0xf0) {
    case 0x90: return { type: b === 0 ? 'off' : 'on', input, channel, note: a, velocity: b, time };
    case 0x80: return { type: 'off', input, channel, note: a, velocity: b, time };
    case 0xb0: return { type: 'cc', input, channel, controller: a, value: b, time };
    case 0xe0: { const raw = a | (b << 7); return { type: 'bend', input, channel, value: (raw - 8192) / (raw < 8192 ? 8192 : 8191), time }; }
    default: return;
  }
}
