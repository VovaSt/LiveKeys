import { Component, input, output } from '@angular/core';
import { createLayer, instruments, instrumentCategories, type LayerEffects, type PerformanceEffects, type LayerConfig, type VelocityCurve } from '../domain/models';
import { EffectsEditorComponent } from './effects-editor';
import { noteName } from '../domain/layers';
import { uk } from './strings';
import { frequencyPosition, frequencyValue } from './frequency-scale';
@Component({ selector: 'app-layer-editor', standalone: true, imports: [EffectsEditorComponent], templateUrl: './layer-editor.html' })
export class LayerEditorComponent {
  readonly layer = input.required<LayerConfig>();
  readonly changed = output<LayerConfig>();
  readonly removed = output<void>();
  readonly canRemove = input(false);
  readonly index = input(1);
  readonly t = uk;
  readonly instruments = instruments;
  readonly categories = instrumentCategories.map(category => ({ ...category, instruments: instruments.filter(i => i.category === category.id) }));
  readonly soundOrder = this.categories.flatMap(category => category.instruments);
  stepSound(direction: number): void {
    const index = this.soundOrder.findIndex(i => i.id === this.layer().instrument.id);
    this.selectInstrument(this.soundOrder[(index + direction + this.soundOrder.length) % this.soundOrder.length]!.id);
  }
  readonly noteName = noteName;
  readonly frequencyPosition = frequencyPosition;
  toggle(field: 'mute' | 'solo' | 'mono'): void {
    if (field === 'mute') {
      this.changed.emit({ ...this.layer(), enabled: true, mute: this.layer().enabled && !this.layer().mute, solo: false });
      return;
    }
    if (field === 'solo') { this.changed.emit({ ...this.layer(), enabled: true, mute: false, solo: !this.layer().solo }); return; }
    this.changed.emit({ ...this.layer(), [field]: !this.layer()[field] });
  }
  numeric(field: 'gainDb' | 'pan' | 'glide' | 'voiceLimit' | 'octave' | 'keyFadeLow' | 'keyFadeHigh', event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value !== '' && target.validity.valid) this.changed.emit({ ...this.layer(), [field]: Number(target.value) });
  }
  range(field: 'keyRange' | 'velocityRange', edge: 0 | 1, event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value === '' || !target.validity.valid) return;
    const range: [number, number] = [...this.layer()[field]];
    range[edge] = Number(target.value);
    if (range[0] > range[1]) range[edge === 0 ? 1 : 0] = range[edge];
    this.changed.emit({ ...this.layer(), [field]: range });
  }
  instrument(event: Event): void {
    this.selectInstrument((event.target as HTMLSelectElement).value);
  }
  private selectInstrument(id: string): void {
    const instrument = instruments.find(i => i.id === id);
    if (instrument) {
      const defaults = createLayer(this.layer().id, instrument);
      this.changed.emit({ ...this.layer(), instrument: defaults.instrument, pad: defaults.pad, mono: defaults.mono, glide: defaults.glide,
        sustainEnabled: defaults.sustainEnabled, effects: defaults.effects });
    }
  }
  curve(event: Event): void { this.changed.emit({ ...this.layer(), velocityCurve: (event.target as HTMLSelectElement).value as VelocityCurve }); }
  effects(value: LayerEffects | PerformanceEffects): void { this.changed.emit({ ...this.layer(), effects: value as LayerEffects }); }
  pad(field: 'attack' | 'release' | 'cutoff' | 'movement', event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value !== '' && target.validity.valid) this.changed.emit({ ...this.layer(), pad: { ...this.layer().pad,
      [field]: field === 'cutoff' ? frequencyValue(Number(target.value), 100, 12000) : Number(target.value) } });
  }
}
