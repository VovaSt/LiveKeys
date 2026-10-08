export class LimiterDSP {
  gain: number;
  constructor(rate?: number);
  process(input: Float32Array[], output: Float32Array[], ceiling: number): number;
}
