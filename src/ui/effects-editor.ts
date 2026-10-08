import { Component, input, output, signal } from '@angular/core';
import type { EffectType, LayerEffects, PerformanceEffects } from '../domain/models';
import { addEffect, effectRack, effectTypes } from '../domain/effects';
import { uk } from './strings';
import { frequencyPosition, frequencyValue } from './frequency-scale';
type Field = { key: string; label: string; min: number; max: number; step: number; unit?: string };
@Component({ selector: 'app-effects-editor', standalone: true, template: `
  @if (layerMode()) {
    <div class="fx-heading"><span>{{ t.layerEffects }} <small>{{ slots().length }}/2</small></span>
      <button class="icon-button" aria-label="Додати ефект" [disabled]="slots().length >= 2" [attr.aria-expanded]="adding()" (click)="adding.set(!adding())"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
    @if (adding() && slots().length < 2) {
      <div class="fx-picker" aria-label="Тип ефекту">
        @for (type of available(); track type) { <button (click)="add(type)">{{ names[type] }}</button> }
        <button class="icon-button" [attr.aria-label]="t.cancel" [attr.title]="t.cancel" (click)="adding.set(false)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
    }
    @for (slot of slots(); track slot.type) {
      <section class="effect-section" [class.effect-on]="slot.enabled" [attr.data-effect]="slot.type">
        <div class="effect-header">
          <strong>{{ names[slot.type] }}</strong>
          <button class="effect-switch" [attr.aria-label]="names[slot.type] + ': увімкнути або вимкнути'" [attr.aria-pressed]="slot.enabled"
            (click)="toggle(slot.type)"><i></i>{{ slot.enabled ? 'Увімкнено' : 'Вимкнено' }}</button>
          <button class="icon-button remove-effect" [attr.aria-label]="'Прибрати ' + names[slot.type]" (click)="remove(slot.type)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
        <label class="slider-label"><span>{{ primary(slot.type).label }} <output>{{ display(primary(slot.type)) }}</output></span>
          <input type="range" [attr.aria-label]="primary(slot.type).label" [min]="sliderMin(primary(slot.type))" [max]="sliderMax(primary(slot.type))"
            [step]="sliderStep(primary(slot.type))" [value]="sliderValue(primary(slot.type))" [attr.aria-valuetext]="display(primary(slot.type))" (input)="numeric(primary(slot.type), $event)">
        </label>
        @if (slot.type === 'filter' || slot.type === 'chorus' || slot.type === 'eq') {
          <details class="fx-details"><summary>Параметри</summary>
            @for (field of extra(slot.type); track field.key) {
              <label class="slider-label"><span>{{ field.label }} <output>{{ display(field) }}</output></span>
                <input type="range" [attr.aria-label]="field.label" [min]="sliderMin(field)" [max]="sliderMax(field)" [step]="sliderStep(field)" [value]="sliderValue(field)" [attr.aria-valuetext]="display(field)" (input)="numeric(field, $event)">
              </label>
            }
          </details>
        }
      </section>
    }
    @if (!slots().length) { <p class="empty-effects">Без ефектів · додайте через +</p> }
  } @else {
    <div class="shared-effects">
      @for (group of groups; track group.name) {
        <section class="effect-section" [class.effect-on]="!group.bypass || !value(group.bypass)">
          <div class="effect-header"><strong>{{ group.name }}</strong>
            @if (group.bypass) { <button class="effect-switch" [attr.aria-pressed]="!value(group.bypass)" (click)="set(group.bypass, !value(group.bypass))"><i></i>{{ value(group.bypass) ? 'Вимкнено' : 'Увімкнено' }}</button> }
          </div>
          @for (field of group.fields; track field.key) {
            <label class="slider-label"><span>{{ field.label }} <output>{{ display(field) }}</output></span>
              <input type="range" [attr.aria-label]="field.label" [min]="sliderMin(field)" [max]="sliderMax(field)" [step]="sliderStep(field)" [value]="sliderValue(field)" [attr.aria-valuetext]="display(field)" (input)="numeric(field, $event)">
            </label>
          }
        </section>
      }
    </div>
  }` })
export class EffectsEditorComponent {
  readonly settings = input.required<LayerEffects | PerformanceEffects>();
  readonly layerMode = input(false);
  readonly changed = output<LayerEffects | PerformanceEffects>();
  readonly adding = signal(false);
  readonly t = uk;
  readonly names: Record<EffectType, string> = { filter: 'Filter', chorus: 'Chorus', reverb: 'Reverb', delay: 'Delay', eq: 'EQ', drive: 'Drive' };
  readonly groups: { name: string; bypass?: string; fields: Field[] }[] = [
    { name: 'Захист виходу', fields: [{ key: 'ceiling', label: uk.ceiling, min: -12, max: -0.1, step: 0.1, unit: 'dBFS' }] },
  ];
  slots() { return effectRack(this.settings() as LayerEffects); }
  available() { return effectTypes.filter(type => !this.slots().some(slot => slot.type === type)); }
  add(type: EffectType): void { this.changed.emit(addEffect(this.settings() as LayerEffects, type)); this.adding.set(false); }
  toggle(type: EffectType): void { this.changed.emit({ ...this.settings(), rack: this.slots().map(slot => slot.type === type ? { ...slot, enabled: !slot.enabled } : slot) } as LayerEffects); }
  remove(type: EffectType): void { this.changed.emit({ ...this.settings(), rack: this.slots().filter(slot => slot.type !== type) } as LayerEffects); }
  value(key: string): number | boolean | string { return (this.settings() as unknown as Record<string, number | boolean | string>)[key] ?? 0; }
  set(key: string, value: number | boolean | string): void { this.changed.emit({ ...this.settings(), [key]: value }); }
  display(field: Field): string { const value = Number(this.value(field.key)); return field.unit ? value + ' ' + field.unit : field.max <= 1 ? Math.round(value * 100) + '%' : String(value); }
  primary(type: EffectType): Field {
    if (type === 'eq') return { key: 'eqMid', label: 'EQ · середина', min: -12, max: 12, step: 1, unit: 'dB' };
    if (type === 'drive') return { key: 'drive', label: 'Насичення', min: 0, max: 1, step: 0.01 };
    return type === 'filter' ? { key: 'cutoff', label: uk.filterCutoff, min: 100, max: 20000, step: 10, unit: 'Hz' } :
      type === 'chorus' ? { key: 'chorusMix', label: uk.chorusMix, min: 0, max: 1, step: 0.05 } :
      type === 'reverb' ? { key: 'reverbSend', label: uk.reverbSend, min: 0, max: 1, step: 0.05 } :
      { key: 'delaySend', label: uk.delaySend, min: 0, max: 1, step: 0.05 };
  }
  extra(type: EffectType): Field[] {
    if (type === 'eq') return [{ key: 'eqLow', label: 'EQ · низ', min: -12, max: 12, step: 1, unit: 'dB' },
      { key: 'eqHigh', label: 'EQ · верх', min: -12, max: 12, step: 1, unit: 'dB' }];
    return type === 'filter' ? [{ key: 'resonance', label: uk.resonance, min: 0.1, max: 6, step: 0.1 }] : [
      { key: 'chorusRate', label: uk.chorusRate, min: 0.05, max: 5, step: 0.05, unit: 'Hz' },
      { key: 'chorusDepth', label: uk.chorusDepth, min: 0, max: 0.008, step: 0.001, unit: 's' }];
  }
  sliderMin(field: Field): number { return field.unit === 'Hz' ? 0 : field.min; }
  sliderMax(field: Field): number { return field.unit === 'Hz' ? 1000 : field.max; }
  sliderStep(field: Field): number | string { return field.unit === 'Hz' ? 'any' : field.step; }
  sliderValue(field: Field): number {
    const value = Number(this.value(field.key));
    return field.unit === 'Hz' ? frequencyPosition(value, field.min, field.max) : value;
  }
  numeric(field: Field, event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value !== '' && target.validity.valid) this.set(field.key, field.unit === 'Hz' ? frequencyValue(Number(target.value), field.min, field.max) : Number(target.value));
  }
}
