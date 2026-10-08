import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const sourceDir = new URL('../sample-source/fluid/', import.meta.url);
const out = new URL('../public/samples/fluid-ensemble/', import.meta.url);
await mkdir(out, { recursive: true });
const source = JSON.parse(await readFile(new URL('source.json', sourceDir), 'utf8'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const rate = 22050, zones = [], hashes = {}, programs = {};
function wave(channels) {
  const frames = channels[0].length, bytes = Buffer.alloc(44 + frames * channels.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels.length, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels.length * 2, 28);
  bytes.writeUInt16LE(channels.length * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++)
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + (i * channels.length + c) * 2);
  return bytes;
}
async function save(name, channels) {
  const bytes = wave(channels); await writeFile(new URL(name, out), bytes);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
try {
  // Decode upstream compressed samples once at build time. Ship PCM WAV: no codec delay at playback.
  for (const [program, data] of Object.entries(source.programs)) {
    if (['88', '93', '94'].includes(program)) continue;
    const selected = Array.from({ length: 128 }, (_, note) => {
      const index = data.zones.findLastIndex(z => z.keyRangeLow <= note && z.keyRangeHigh >= note);
      if (index >= 0) return index;
      return data.zones.reduce((best, z, i) => Math.abs(z.originalPitch / 100 - note) < Math.abs(data.zones[best].originalPitch / 100 - note) ? i : best, 0);
    });
    programs[program] = [];
    for (const index of new Set(selected)) {
      const z = data.zones[index], encoded = (await readFile(new URL(z.file, sourceDir))).toString('base64');
      const decoded = await page.evaluate(async ({ encoded, rate, z }) => {
        const context = new OfflineAudioContext(1, 1, rate);
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        const start = Math.round(z.loopStart / z.sampleRate * rate), end = Math.round(z.loopEnd / z.sampleRate * rate);
        if (!(start >= 0 && end > start + 8 && end <= buffer.length)) throw new Error('Invalid source loop');
        const samples = Array.from(buffer.getChannelData(0).slice(0, end));
        // A short endpoint correction suppresses codec-induced clicks while preserving loop timing.
        const fade = Math.min(128, Math.floor((end - start) / 8));
        const difference = samples[start] - samples[end - 1];
        for (let i = 0; i < fade; i++) samples[end - fade + i] += difference * (i + 1) / fade;
        let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value));
        if (peak < 0.0001) throw new Error('Silent sample');
        for (let i = 0; i < samples.length; i++) samples[i] *= 0.65 / peak;
        return { samples, start, end };
      }, { encoded, rate, z });
      const name = `${program}-${index}.wav`;
      await save(name, [decoded.samples]);
      const rootNote = Math.floor(z.originalPitch / 100), tuningCents = rootNote * 100 - z.originalPitch + z.coarseTune * 100 + z.fineTune;
      const entry = { id: `${program}-${index}`, sampleSet: program, url: `samples/fluid-ensemble/${name}`, rootNote,
        keyRange: [0, 127], velocityRange: [1, 127], tuningCents, gainDb: -3, loop: { start: decoded.start / rate, end: decoded.end / rate } };
      programs[program].push({ ...entry, samples: decoded.samples });
      // Split overlapping SF2 ranges into disjoint ranges with the upstream last-zone priority.
      for (let low = 0; low < 128;) {
        let high = low; while (high < 127 && selected[high + 1] === selected[low]) high++;
        if (selected[low] === index) zones.push({ ...entry, id: `${entry.id}-${low}`, keyRange: [low, high] });
        low = high + 1;
      }
    }
  }
  // Bake stereo layering and slow movement into ready-made Fluid samples, never into live oscillators.
  const mixes = { aurora: [[89, -0.8, 0], [91, 0.8, 7]], ocean: [[95, -0.85, -5], [90, 0.85, 5]],
    symphony: [[48, -0.55, -3], [61, 0.55, 3]] };
  for (const [sampleSet, mix] of Object.entries(mixes)) {
    const roots = [36, 42, 48, 54, 60, 66, 72, 78, 84];
    for (const [index, note] of roots.entries()) {
      const parts = mix.map(([program, pan, detune]) => {
        const zone = zones.find(z => z.sampleSet === String(program) && note >= z.keyRange[0] && note <= z.keyRange[1]);
        return { ...zone, samples: programs[program].find(z => z.url === zone.url).samples, pan, detune };
      });
      const channels = await page.evaluate(async ({ parts, note, rate, sampleSet }) => {
        const context = new OfflineAudioContext(2, rate * 5, rate);
        for (const [index, part] of parts.entries()) {
          const buffer = context.createBuffer(1, part.samples.length, rate); buffer.copyToChannel(Float32Array.from(part.samples), 0);
          const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
          source.buffer = buffer; source.loop = true; source.loopStart = part.loop.start; source.loopEnd = part.loop.end;
          source.playbackRate.value = 2 ** ((note - part.rootNote + (part.tuningCents + part.detune) / 100) / 12);
          pan.pan.value = part.pan; gain.gain.value = 0.45;
          if (sampleSet !== 'symphony') {
            const curve = Float32Array.from({ length: 501 }, (_, i) => 0.35 + 0.18 * Math.sin(i / 500 * Math.PI * 4 + index * Math.PI));
            gain.gain.setValueCurveAtTime(curve, 0, 5);
          }
          source.connect(gain).connect(pan).connect(context.destination); source.start();
        }
        const rendered = await context.startRendering();
        // Keep attack, then loop [1, 4] s. Crossfade the final second into the preceding loop lead-in.
        return [0, 1].map(c => {
          const input = rendered.getChannelData(c), output = input.slice(0, rate * 4);
          for (let i = 0; i < rate; i++) {
            const t = i / (rate - 1);
            output[rate * 3 + i] = input[rate * 3 + i] * (1 - t) + input[i] * t;
          }
          output[output.length - 1] = output[rate];
          return Array.from(output);
        });
      }, { parts, note, rate, sampleSet });
      const name = `${sampleSet}-${note}.wav`; await save(name, channels);
      zones.push({ id: `${sampleSet}-${note}`, sampleSet, url: `samples/fluid-ensemble/${name}`, rootNote: note,
        keyRange: [index === 0 ? 0 : note - 3, index === roots.length - 1 ? 127 : note + 2], velocityRange: [1, 127],
        tuningCents: 0, gainDb: 0, loop: { start: 1, end: 4 } });
    }
  }
  await writeFile(new URL('manifest.json', out), JSON.stringify({ schemaVersion: 1, id: 'fluid-ensemble', version: '1', license: 'MIT', demo: false,
    decodeSampleRate: rate, sourceRevision: source.revision, zones }, null, 2));
  await writeFile(new URL('SHA256.json', out), JSON.stringify(hashes, null, 2));
  await copyFile(new URL('source.json', sourceDir), new URL('SOURCE.json', out));
  for (const name of ['FluidR3-LICENSE.txt', 'WebAudioFont-LICENSE.txt']) await copyFile(new URL(name, sourceDir), new URL(name, out));
  await writeFile(new URL('ATTRIBUTION.txt', out), `FluidR3 samples: Copyright (c) 2000-2002, 2008 Frank Wen. MIT license.\nSource: https://github.com/surikov/webaudiofontdata/tree/${source.revision}\nWebAudioFont data conversion: Sergey Surikov (see included license). No WebAudioFont playback code is included.\nAdaptations: 22050 Hz PCM WAV, normalized mono zones with original loop timing and endpoint correction; offline stereo sample blends for Aurora/Ocean/Symphony.\nThis is an adapted subset, not the full FluidR3 bank. See SOURCE.json and both license files.\n`);
  console.log(`Built ${zones.length} zones, ${Object.keys(hashes).length} WAV files.`);
} finally { await browser.close(); }
