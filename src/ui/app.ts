import { Component, OnDestroy, computed, signal } from '@angular/core';
import { audibleLayers, keyRangeGain, noteName } from '../domain/layers';
import { WebAudioEngine } from '../audio-web/engine';
import { NoteRouter } from '../domain/router';
import { createLayer, defaultSettings, type AppSettings, type LayerConfig, type PerformancePreset } from '../domain/models';
import { DataError, makeBackup, MAX_BACKUP_BYTES, parseBackup, parsePreset } from '../domain/serialization';
import { IndexedPresetRepository } from '../storage-web/repository';
import { LayerEditorComponent } from './layer-editor';
import { WebMidiService } from '../midi-web/service';
import { uk } from './strings';
import { factoryPresets } from '../domain/factory';
import type { LayerEffects, PerformanceEffects } from '../domain/models';
import { EffectsEditorComponent } from './effects-editor';
import { TutorialComponent } from './tutorial';

@Component({ selector: 'app-root', standalone: true, imports: [LayerEditorComponent, EffectsEditorComponent, TutorialComponent], templateUrl: './app.html' })
export class AppComponent implements OnDestroy {
  readonly t = uk;
  readonly factories = factoryPresets;
  readonly bankIds = ['salamander-3v', 'fluid-ensemble', 'felt-piano', 'worship-textures'];
  readonly bankNames: Record<string, string> = { 'salamander-3v': 'Grand Piano · 3 velocity', 'fluid-ensemble': 'FluidR3 · педи, оркестр, хор', 'felt-piano': 'Felt Piano · Fuchs & Möhr · 3 velocity', 'worship-textures': 'Shimmer Pad · Choir Bloom' };
  readonly bankStates = signal(new Map<string, string>());
  readonly engine = new WebAudioEngine();
  readonly router = new NoteRouter(this.engine, factoryPresets[0]!, factoryPresets[0]!.id);
  readonly midi = new WebMidiService(this.router, stamp => this.engine.midiTime(stamp),
    () => this.inputs.set(this.midi.inputs()), name => this.notice.set(`${uk.disconnected} ${name}`));
  readonly inputs = signal(this.midi.inputs());
  readonly info = signal(this.engine.diagnostics());
  readonly busy = signal(false);
  readonly midiBusy = signal(false);
  readonly midiConnected = signal(false);
  readonly midiError = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly masterDb = signal(-6);
  readonly outputMono = signal(false);
  readonly layerColors = ['#bddbad', '#d6b58a', '#9dbedc', '#c9a6d3'];
  readonly pedals = signal(0);
  readonly notes = signal<number[]>([]);
  readonly activity = signal(false);
  readonly preset = signal(structuredClone(factoryPresets[0]!));
  readonly savedPresets = signal<PerformancePreset[]>([]);
  readonly newPresetName = signal<string | null>(null);
  presetDisplayName(name: string): string { return name.replace(/^\d+\s*·\s*/, ''); }
  beginSaveAs(): void {
    const base = [...new Set(this.preset().layers.map(l => l.instrument.name))].join(' + ').slice(0, 70);
    let name = base, suffix = 2;
    while (this.savedPresets().some(p => p.name === name)) name = `${base} (${suffix++})`;
    this.newPresetName.set(name);
  }
  readonly dirty = signal(false);
  readonly restoring = signal(true);
  readonly storageBusy = signal(false);
  readonly storageError = signal('');
  readonly storageStatus = signal('');
  readonly importError = signal('');
  readonly deleting = signal(false);
  readonly globalTranspose = signal(0);
  readonly voiceLimit = signal<32 | 64>(64);
  private repository = new IndexedPresetRepository();
  private rememberedInputs: string[] = [];
  private draftTimer?: ReturnType<typeof setTimeout>;
  private settingsTimer?: ReturnType<typeof setTimeout>;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private draftRevision = 0;
  private destroyed = false;
  private pointers = new Map<number, number>();
  private computer = new Map<string, number>();
  private accessible = new Set<number>();
  private timer: ReturnType<typeof setInterval>;
  private bindings = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK'];
  readonly keys = (() => {
    let white = 0;
    return Array.from({ length: 88 }, (_, index) => {
      const note = 21 + index; const black = [1, 3, 6, 8, 10].includes(note % 12);
      const left = black ? white - 0.32 : white++;
      return { note, black, left: left / 52 * 100, width: (black ? 0.64 : 1) / 52 * 100,
        label: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12]! + (Math.floor(note / 12) - 1) };
    });
  })();
  readonly rangeRows = computed(() => {
    const preset = this.preset(), audible = new Set(audibleLayers(preset).map(layer => layer.id));
    return preset.layers.map((layer, index) => {
      const low = Math.max(21, layer.keyRange[0]), high = Math.min(108, layer.keyRange[1]);
      const first = this.keys[low - 21], last = this.keys[high - 21];
      const visible = low <= high && !!first && !!last;
      const width = visible ? last.left + last.width - first.left : 0;
      // Use actual key positions and the engine's gain curve, including overlapping fades.
      const stops = visible ? this.keys.filter(key => key.note >= low && key.note <= high).map(key => {
        const position = (key.left + key.width / 2 - first.left) / width * 100;
        return `rgb(0 0 0 / ${keyRangeGain(layer, key.note)}) ${position}%`;
      }) : [];
      const fadeMask = visible ? `linear-gradient(to right, rgb(0 0 0 / ${keyRangeGain(layer, low)}) 0%, ${stops.join(', ')}, rgb(0 0 0 / ${keyRangeGain(layer, high)}) 100%)` : '';
      return { id: layer.id, name: layer.instrument.name, index: index + 1, color: this.layerColors[index],
        audible: audible.has(layer.id), left: visible ? first.left : 0,
        width, fadeMask,
        label: 'Шар ' + (index + 1) + ' · ' + layer.instrument.name + ': ' + noteName(layer.keyRange[0]) + '–' + noteName(layer.keyRange[1]) };
    });
  });
  constructor() {
    this.engine.onSuspended = () => this.panic(false);
    void this.restore();
    // Telemetry only: never schedules or triggers audio.
    this.timer = setInterval(() => {
      const state = this.engine.diagnostics();
      if (this.info().state === 'running' && state.state !== 'running') this.panic(false);
      this.info.set(state); this.notes.set(this.router.heldNotes); this.pedals.set(this.router.sustainCount);
      this.bankStates.set(new Map(this.engine.banks));
      this.activity.set(this.midi.activity > 0 && performance.now() - this.midi.activity < 180);
    }, 100);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.releaseLocal);
    document.addEventListener('visibilitychange', this.visibility);
  }
  private async restore(): Promise<void> {
    try {
      const [presets, draft, settings] = await Promise.all([this.repository.list(), this.repository.draft(), this.repository.settings()]);
      if (this.destroyed) return;
      this.savedPresets.set(presets);
      if (draft) {
        this.preset.set(draft.preset); this.dirty.set(draft.dirty);
        this.router.activate(draft.preset, draft.preset.id); this.notice.set(uk.draftRestored);
      }
      if (settings) {
        this.masterDb.set(settings.masterDb); this.voiceLimit.set(settings.voiceLimit); this.globalTranspose.set(settings.globalTranspose);
        this.outputMono.set(settings.outputMono);
        this.engine.updateParameters(settings); this.router.setGlobalTranspose(settings.globalTranspose);
        this.rememberedInputs = settings.selectedInputs;
        if (settings.selectedInputs.length) this.notice.update(message => `${message} ${uk.restoredInputs}`.trim());
      }
    } catch { this.storageError.set(uk.storageError); }
    finally { this.restoring.set(false); }
  }
  private queueWrite(task: () => Promise<void>): Promise<void> {
    const write = this.writeQueue.catch(() => {}).then(task); this.writeQueue = write; return write;
  }
  private scheduleDraft(): void {
    clearTimeout(this.draftTimer); ++this.draftRevision; this.storageStatus.set(uk.draftSaving);
    this.draftTimer = setTimeout(() => { this.draftTimer = undefined; void this.persistDraft(); }, 300);
  }
  private async persistDraft(): Promise<void> {
    const draft = { preset: structuredClone(this.preset()), dirty: this.dirty() }; const revision = this.draftRevision;
    try {
      await this.queueWrite(() => this.repository.saveDraft(draft));
      if (revision === this.draftRevision) { this.storageError.set(''); this.storageStatus.set(uk.draftSaved); }
    } catch { this.storageError.set(uk.storageError); this.storageStatus.set(''); }
  }
  private settings(): AppSettings {
    return { ...defaultSettings, masterDb: this.masterDb(), voiceLimit: this.voiceLimit(), globalTranspose: this.globalTranspose(), selectedInputs: this.rememberedInputs, outputMono: this.outputMono() };
  }
  private scheduleSettings(): void {
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => { this.settingsTimer = undefined; void this.persistSettings(); }, 200);
  }
  private async persistSettings(): Promise<void> {
    const settings = this.settings();
    try { await this.queueWrite(() => this.repository.saveSettings(settings)); this.storageError.set(''); }
    catch { this.storageError.set(uk.storageError); }
  }
  async editPreset(next: PerformancePreset): Promise<void> {
    if (this.busy() || this.storageBusy() || this.restoring()) return;
    try {
      next = parsePreset(next);
      if (this.info().ready) {
        if (this.engine.needsPreparation(next)) {
          this.busy.set(true); await this.engine.preparePreset(next);
        }
        this.engine.updatePreset(next);
      }
      this.router.updatePreset(next, this.engine.now()); this.preset.set(next); this.dirty.set(true); this.error.set('');
      this.scheduleDraft();
    } catch (error) { console.error('Preset preparation failed', error); this.error.set(uk.switchError); }
    finally { this.busy.set(false); }
  }
  editLayer(layer: LayerConfig): void {
    void this.editPreset({ ...this.preset(), layers: this.preset().layers.map(l => l.id === layer.id ? layer : l) });
  }
  editEffects(effects: LayerEffects | PerformanceEffects): void { void this.editPreset({ ...this.preset(), effects: effects as PerformanceEffects }); }
  masterLevel(): number { return Math.max(0, Math.min(100, (20 * Math.log10(Math.max(0.001, this.info().peakAfter)) + 60) / 60 * 100)); }
  bankState(id: string): string {
    return ({ ready: uk.bankReady, loading: uk.bankLoading, error: uk.bankError } as Record<string, string>)[this.bankStates().get(id) ?? ''] ?? uk.bankMissing;
  }
  async loadBank(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { await this.engine.init(); await this.engine.loadBank(id); }
    catch { this.error.set(uk.bankFailure); }
    finally { this.bankStates.set(new Map(this.engine.banks)); this.busy.set(false); }
  }
  addLayer(): void {
    if (this.preset().layers.length >= 4) return;
    void this.editPreset({ ...this.preset(), layers: [...this.preset().layers, createLayer('layer-' + crypto.randomUUID())] });
  }
  removeLayer(id: string): void {
    if (this.preset().layers.length > 1) void this.editPreset({ ...this.preset(), layers: this.preset().layers.filter(l => l.id !== id) });
  }
  rename(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value.trim() && target.validity.valid) void this.editPreset({ ...this.preset(), name: target.value.trim() });
    else target.value = this.preset().name;
  }
  transpose(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value === '' || !target.validity.valid) return;
    const value = Number(target.value); this.globalTranspose.set(value); this.router.setGlobalTranspose(value); this.scheduleSettings();
  }
  isUserPreset(): boolean { return this.savedPresets().some(p => p.id === this.preset().id); }
  async save(copy = false): Promise<void> {
    if (this.storageBusy() || this.busy() || this.restoring() || (!copy && !this.isUserPreset()) || (copy && !this.newPresetName()?.trim())) return;
    this.storageBusy.set(true); this.deleting.set(false); clearTimeout(this.draftTimer); ++this.draftRevision;
    const next = { ...structuredClone(this.preset()), id: copy || !this.isUserPreset() ? 'user-' + crypto.randomUUID() : this.preset().id };
    if (copy) next.name = this.newPresetName()!.trim().slice(0, 80);
    try {
      await this.queueWrite(() => this.repository.save(next));
      this.savedPresets.set(await this.repository.list());
      this.preset.set(next); this.dirty.set(false); this.router.updatePreset(next, this.engine.now());
      await this.persistDraft();
      // Explicit Save flushes pending global settings too, so immediate reload is safe.
      clearTimeout(this.settingsTimer); this.settingsTimer = undefined; await this.persistSettings();
      this.notice.set(uk.saved);
      this.newPresetName.set(null);
    } catch (error) { this.storageError.set(error instanceof DataError && error.code === 'size' ? uk.fileTooLarge : uk.storageError); }
    finally { this.storageBusy.set(false); }
  }
  choosePreset(event: Event): void {
    const target = event.target as HTMLSelectElement, id = target.value; target.value = this.preset().id;
    void this.openPreset(id);
  }
  async openPreset(id: string): Promise<void> {
    if (this.busy() || this.storageBusy()) return;
    const next = [...factoryPresets, ...this.savedPresets()].find(p => p.id === id);
    if (!next) return;
    this.busy.set(true); this.error.set(''); this.deleting.set(false);
    try {
      let instance = next.id;
      if (this.info().ready) { instance = await this.engine.preparePreset(next); this.engine.activatePreparedPreset(instance); }
      this.router.activate(next, instance); this.preset.set(structuredClone(next)); this.dirty.set(false);
      this.newPresetName.set(null);
      this.scheduleDraft();
    } catch { this.error.set(uk.switchError); }
    finally { this.busy.set(false); }
  }
  async deletePreset(): Promise<void> {
    if (!this.isUserPreset() || this.storageBusy()) return;
    this.storageBusy.set(true);
    try {
      await this.queueWrite(() => this.repository.remove(this.preset().id));
      this.savedPresets.set(await this.repository.list()); this.dirty.set(true); this.scheduleDraft(); this.storageError.set('');
    } catch { this.storageError.set(uk.storageError); }
    finally { this.storageBusy.set(false); this.deleting.set(false); }
  }
  exportPresets(): void {
    try {
      // Include the current draft separately, even when a saved version has the same ID.
      const current = { ...this.preset(), id: 'draft-' + crypto.randomUUID() };
      const backup = makeBackup([...this.savedPresets(), current], this.settings());
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'live-keys-presets.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); this.notice.set(uk.exported);
    } catch { this.importError.set(uk.fileTooLarge); }
  }
  async importPresets(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file || this.storageBusy()) return;
    this.storageBusy.set(true); this.importError.set('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new DataError('size');
      const backup = parseBackup(await file.text());
      const copies = backup.presets.map(p => ({ ...p, id: 'user-' + crypto.randomUUID() }));
      await this.queueWrite(() => this.repository.saveMany(copies));
      this.savedPresets.set(await this.repository.list()); this.notice.set(uk.imported); this.storageError.set('');
    } catch (error) {
      if (error instanceof DataError) this.importError.set(error.code === 'missing-instrument' ? uk.missingSounds : error.code === 'size' ? uk.fileTooLarge : uk.importError);
      else this.storageError.set(uk.storageError);
    } finally { this.storageBusy.set(false); }
  }
  get audioState(): string {
    switch (this.info().state) {
      case 'running': return uk.running;
      case 'suspended': case 'interrupted': return uk.suspended;
      case 'closed': return uk.closed;
      default: return uk.notStarted;
    }
  }
  async start(): Promise<void> {
    if (this.busy() || this.restoring()) return;
    this.busy.set(true); this.error.set('');
    try {
      if (!('AudioContext' in window)) { this.error.set(uk.audioUnsupported); return; }
      await this.engine.init();
      if (!this.engine.diagnostics().ready) {
        const preset = this.preset(); const id = await this.engine.preparePreset(preset); this.engine.activatePreparedPreset(id); this.router.activate(preset, id);
      }
      this.info.set(this.engine.diagnostics());
    } catch (error) { console.error(error); this.error.set(uk.audioError); }
    finally { this.busy.set(false); }
  }
  async connectMidi(): Promise<void> {
    if (this.midiBusy()) return;
    this.midiBusy.set(true); this.midiError.set('');
    try { await this.midi.connect(); this.midiConnected.set(true); }
    catch (error) {
      this.midiError.set(error instanceof Error && error.message === 'MIDI_UNSUPPORTED' ? uk.midiUnsupported :
        error instanceof Error && error.name === 'NotAllowedError' ? uk.midiDenied : uk.midiError);
    } finally { this.midiBusy.set(false); }
  }
  selectInput(id: string, event: Event): void {
    this.midi.select(id, (event.target as HTMLInputElement).checked);
    this.rememberedInputs = this.midi.inputs().filter(i => i.selected).map(i => i.id); this.scheduleSettings();
  }
  volume(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.masterDb.set(value); this.engine.updateParameters({ masterDb: value });
    this.scheduleSettings();
  }
  toggleOutput(): void {
    this.outputMono.update(value => !value); this.engine.updateParameters({ outputMono: this.outputMono() }); this.scheduleSettings();
  }
  profile(event: Event): void {
    const voiceLimit = Number((event.target as HTMLSelectElement).value) === 32 ? 32 : 64;
    this.voiceLimit.set(voiceLimit); this.engine.updateParameters({ voiceLimit }); this.scheduleSettings();
  }
  private note(input: string, note: number, down: boolean): void {
    if (down && (!this.info().ready || this.info().state !== 'running')) return;
    this.router.handle({ input, channel: 1, type: down ? 'on' : 'off', note, velocity: down ? 96 : 0, time: this.engine.now() });
    this.notes.set(this.router.heldNotes);
  }
  pointerDown(note: number, event: PointerEvent): void {
    if (event.button !== 0 || this.pointers.has(event.pointerId)) return;
    event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, note); this.note('screen', note, true);
  }
  pointerUp(event: PointerEvent): void {
    const note = this.pointers.get(event.pointerId);
    if (note === undefined) return;
    this.pointers.delete(event.pointerId); this.note('screen', note, false);
  }
  keyButton(note: number, event: KeyboardEvent, down: boolean): void {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (down && !this.accessible.has(note)) { this.accessible.add(note); this.note('accessible', note, true); }
    else if (!down && this.accessible.delete(note)) this.note('accessible', note, false);
  }
  blurButton(note: number): void { if (this.accessible.delete(note)) this.note('accessible', note, false); }
  panic(announce = true): void {
    this.router.panic(this.engine.now()); this.pointers.clear(); this.computer.clear(); this.accessible.clear();
    this.notes.set([]); this.pedals.set(0);
    if (announce) this.notice.set(uk.panicDone);
  }
  private keydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (event.code === 'Escape') { this.panic(); return; }
    if (document.querySelector('dialog[open]')) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = this.bindings.indexOf(event.code);
    if (index < 0) return;
    event.preventDefault(); this.computer.set(event.code, 60 + index); this.note('computer', 60 + index, true);
  };
  private keyup = (event: KeyboardEvent): void => {
    const note = this.computer.get(event.code);
    if (note === undefined) return;
    this.computer.delete(event.code); this.note('computer', note, false);
  };
  private releaseLocal = (): void => {
    for (const input of ['screen', 'computer', 'accessible']) this.router.clearInput(input, this.engine.now());
    this.pointers.clear(); this.computer.clear(); this.accessible.clear(); this.notes.set(this.router.heldNotes);
  };
  private visibility = (): void => { if (document.hidden) this.releaseLocal(); };
  ngOnDestroy(): void {
    this.destroyed = true; clearTimeout(this.draftTimer); clearTimeout(this.settingsTimer);
    void this.writeQueue.catch(() => {}).then(() => this.repository.close());
    clearInterval(this.timer); this.midi.dispose(); this.router.panic(this.engine.now()); void this.engine.dispose();
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.releaseLocal); document.removeEventListener('visibilitychange', this.visibility);
  }
  ms(value?: number): string { return value === undefined ? uk.unavailable : `${(value * 1000).toFixed(1)} ms`; }
}
