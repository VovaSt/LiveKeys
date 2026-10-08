/** Gentle asymmetric soft saturation, normalized to unity small-signal gain. */
export function tubeTransfer(input: number): number {
  const bias = 0.15, slope = 1.2, center = Math.tanh(bias);
  return (Math.tanh(slope * input + bias) - center) / (slope * (1 - center * center));
}
export function tubeGain(amount: number): number { return 1 + 2 * amount * amount; }
