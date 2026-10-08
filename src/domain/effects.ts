import type { EffectSlot, EffectType, LayerEffects } from './models';
export const effectTypes: EffectType[] = ['filter', 'chorus', 'reverb', 'delay', 'eq', 'drive'];
/** Older presets keep their parameters; only the first two populated effects enter the rack. */
export function effectRack(e: LayerEffects): EffectSlot[] {
  if (e.rack) return e.rack;
  return effectTypes.filter(type => type === 'filter' ? e.cutoff < 20000 || e.resonance !== 0.7 :
    type === 'chorus' ? !e.chorusBypass : type === 'reverb' ? e.reverbSend > 0 : type === 'delay' ? e.delaySend > 0 : false)
    .slice(0, 2).map(type => ({ type, enabled: true }));
}
export function effectiveEffects(e: LayerEffects): LayerEffects {
  const enabled = (type: EffectType) => effectRack(e).some(slot => slot.type === type && slot.enabled);
  return { ...e, cutoff: enabled('filter') ? e.cutoff : 20000, resonance: enabled('filter') ? e.resonance : 0.7,
    chorusBypass: !enabled('chorus'), reverbSend: enabled('reverb') ? e.reverbSend : 0, delaySend: enabled('delay') ? e.delaySend : 0 };
}
export function addEffect(e: LayerEffects, type: EffectType): LayerEffects {
  const rack = effectRack(e);
  if (rack.length >= 2 || rack.some(slot => slot.type === type)) return e;
  return { ...e, rack: [...rack, { type, enabled: true }],
    ...(type === 'filter' ? { cutoff: e.cutoff === 20000 ? 5000 : e.cutoff } :
      type === 'chorus' ? { chorusBypass: false } :
      type === 'reverb' ? { reverbSend: e.reverbSend || 0.2 } : type === 'delay' ? { delaySend: e.delaySend || 0.2 } :
      type === 'eq' ? { eqLow: e.eqLow ?? 0, eqMid: e.eqMid ?? 0, eqHigh: e.eqHigh ?? 0 } : { drive: e.drive ?? 0.25 }) };
}
