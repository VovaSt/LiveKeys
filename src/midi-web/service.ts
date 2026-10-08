import type { MidiInputInfo, MidiService } from '../domain/contracts';
import { normalizeMidi } from '../domain/midi';
import type { NoteRouter } from '../domain/router';
export class WebMidiService implements MidiService {
  private access?: MIDIAccess;
  private selected = new Set<string>();
  private attached = new Map<string, MIDIInput>();
  activity = 0;
  constructor(private router: NoteRouter, private clock: (timestamp: number) => number,
    private changed: () => void, private disconnected: (name: string) => void) {}
  async connect(): Promise<void> {
    if (this.access) { this.refresh(); return; }
    if (!navigator.requestMIDIAccess || !window.isSecureContext) throw new Error('MIDI_UNSUPPORTED');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.refresh(); this.refresh();
  }
  inputs(): MidiInputInfo[] {
    return [...this.access?.inputs.values() ?? []].filter(i => i.state === 'connected')
      .map(i => ({ id: i.id, name: i.name ?? 'MIDI', manufacturer: i.manufacturer ?? '', selected: this.selected.has(i.id) }));
  }
  select(id: string, enabled: boolean): void {
    const input = this.access?.inputs.get(id);
    if (enabled && input?.state === 'connected') this.selected.add(id);
    else { this.selected.delete(id); this.router.clearInput(id, this.clock(performance.now())); }
    this.refresh();
  }
  private refresh(): void {
    for (const [id, input] of this.attached) {
      if (input.state !== 'connected' || !this.selected.has(id)) {
        input.onmidimessage = null; this.attached.delete(id);
        this.router.clearInput(id, this.clock(performance.now()));
        if (input.state !== 'connected') { this.selected.delete(id); this.disconnected(input.name ?? 'MIDI'); }
      }
    }
    for (const input of this.access?.inputs.values() ?? []) {
      if (input.state !== 'connected' || !this.selected.has(input.id) || this.attached.has(input.id)) continue;
      input.onmidimessage = event => {
        this.activity = performance.now();
        const message = event.data && normalizeMidi(event.data, input.id, this.clock(event.timeStamp));
        if (message) this.router.handle(message);
      };
      this.attached.set(input.id, input);
    }
    this.changed();
  }
  dispose(): void {
    for (const [id, input] of this.attached) {
      input.onmidimessage = null; this.router.clearInput(id, this.clock(performance.now()));
    }
    if (this.access) this.access.onstatechange = null;
    this.attached.clear(); this.selected.clear(); this.access = undefined;
  }
}
