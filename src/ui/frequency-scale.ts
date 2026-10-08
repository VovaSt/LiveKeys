/** UI position only; domain values and presets always store Hz. */
export function frequencyPosition(hz: number, min: number, max: number): number {
  return Math.log(Math.max(min, Math.min(max, hz)) / min) / Math.log(max / min) * 1000;
}
export function frequencyValue(position: number, min: number, max: number): number {
  const hz = min * (max / min) ** (Math.max(0, Math.min(1000, position)) / 1000);
  return Math.max(min, Math.min(max, Number(hz.toFixed(min < 1 ? 3 : 0))));
}
