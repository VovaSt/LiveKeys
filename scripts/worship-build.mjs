import { readFile, writeFile, mkdir, open, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const root = new URL('../public/samples/', import.meta.url), rate = 22050;
const sfPath = new URL('../sample-source/felt/FuchsUndMoehrV10.sf2', import.meta.url);
const hash = createHash('sha256'); for await (const chunk of createReadStream(sfPath)) hash.update(chunk);
const sourceHash = hash.digest('hex');
if (sourceHash !== 'cf6fdb8ff22a61732364659b341539ad4806d96616fb718917238bcd37bebc7f') throw new Error('Unexpected Felt Piano source revision');
const sf = await open(sfPath, 'r');
async function read(offset, size) { const buffer = Buffer.alloc(size); const { bytesRead } = await sf.read(buffer, 0, size, offset); if (bytesRead !== size) throw new Error('Truncated SF2'); return buffer; }
const head = await read(0, 12); if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8) !== 'sfbk') throw new Error('Not SF2');
const chunks = {};
for (let p = 12; p < head.readUInt32LE(4) + 8;) {
  const header = await read(p, 12), size = header.readUInt32LE(4);
  if (header.toString('ascii', 0, 4) === 'LIST') for (let q = p + 12; q < p + 8 + size;) {
    const child = await read(q, 8), n = child.readUInt32LE(4); chunks[child.toString('ascii', 0, 4)] = { offset: q + 8, size: n }; q += 8 + n + n % 2;
  }
  p += 8 + size + size % 2;
}
const sh = await read(chunks.shdr.offset, chunks.shdr.size), headers = new Map();
for (let p = 0; p < sh.length - 46; p += 46) headers.set(sh.toString('ascii', p, p + 20).replace(/\0.*$/, ''),
  { start: sh.readUInt32LE(p + 20), end: sh.readUInt32LE(p + 24), rate: sh.readUInt32LE(p + 36), pitch: sh[p + 40], correction: sh.readInt8(p + 41) });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
function wave(channels) {
  const frames = channels[0].length, bytes = Buffer.alloc(44 + frames * channels.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels.length, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * channels.length * 2, 28); bytes.writeUInt16LE(channels.length * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + (i * channels.length + c) * 2);
  return bytes;
}
async function bank(id, build, attribution, license) {
  const out = new URL(id + '/', root); await mkdir(out, { recursive: true }); const zones = [], hashes = {};
  async function save(name, channels, zone) {
    const bytes = wave(channels); await writeFile(new URL(name + '.wav', out), bytes); hashes[name + '.wav'] = createHash('sha256').update(bytes).digest('hex');
    zones.push({ id: name, url: `samples/${id}/${name}.wav`, tuningCents: 0, gainDb: 0, ...zone });
  }
  await build(save);
  await writeFile(new URL('manifest.json', out), JSON.stringify({ schemaVersion: 1, id, version: '1', license, demo: false, decodeSampleRate: rate, zones }, null, 2));
  await writeFile(new URL('SHA256.json', out), JSON.stringify(hashes, null, 2));
  await writeFile(new URL('ATTRIBUTION.txt', out), attribution);
  console.log(id, zones.length, 'zones');
}
try {
  await bank('felt-piano', async save => {
    const roots = [...Array.from({ length: 15 }, (_, i) => 21 + i * 6), 108];
    for (const [index, note] of roots.entries()) for (const [dynamic, velocityRange] of [['p', [1, 50]], ['m', [51, 94]], ['f', [95, 127]]]) {
      const left = headers.get(`${dynamic}${note}L`), right = headers.get(`${dynamic}${note}R`);
      if (!left || !right) throw new Error('Missing source note ' + dynamic + note);
      const seconds = note < 60 ? 12 : 8;
      const frames = Math.min(left.end - left.start, right.end - right.start, left.rate * seconds);
      const channels = await Promise.all([left, right].map(async h => (await read(chunks.smpl.offset + h.start * 2, frames * 2)).toString('base64')));
      const rendered = await page.evaluate(async ({ channels, sourceRate, frames, rate }) => {
        const context = new OfflineAudioContext(1, Math.ceil(frames * rate / sourceRate), rate);
        const buffer = context.createBuffer(1, frames, sourceRate), mono = buffer.getChannelData(0);
        for (const encoded of channels) { const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), view = new DataView(raw.buffer);
          for (let i = 0; i < frames; i++) mono[i] += view.getInt16(i * 2, true) / 65536; }
        const source = context.createBufferSource(), dc = context.createBiquadFilter();
        dc.type = 'highpass'; dc.frequency.value = 15; dc.Q.value = 0.707;
        source.buffer = buffer; source.connect(dc).connect(context.destination); source.start();
        const data = (await context.startRendering()).getChannelData(0);
        let peak = 0; for (const value of data) peak = Math.max(peak, Math.abs(value));
        if (peak < 0.0001) throw new Error('Silent Felt sample');
        for (let i = 0; i < data.length; i++) data[i] *= 0.7 / peak * Math.min(1, i / (rate * 0.003), (data.length - 1 - i) / rate);
        return Array.from(data);
      }, { channels, sourceRate: left.rate, frames, rate });
      await save(`${dynamic}-${note}`, [rendered], { rootNote: note, velocityRange,
        keyRange: [index === 0 ? 0 : Math.floor((roots[index - 1] + note) / 2) + 1, index === roots.length - 1 ? 127 : Math.floor((note + roots[index + 1]) / 2)] });
    }
  }, `Fuchs & Mohr Felt Piano, recorded by Tom Guder. Public Domain, explicitly declared by the author:\nhttps://www.polyphone.io/en/forum/your-creations/850-acoustic-felt-piano-upright-fuchs-mohr\nSource: https://drive.google.com/file/d/1NCaVdQQyK4YbbA9ztrkBQYN8jpvbcQDG/view\nOriginal SF2 SHA256: ${sourceHash}\nAdaptation: 16 roots, 3 recorded velocity layers, stereo downmix to mono, 22050 Hz PCM16, 15 Hz DC filter, peak reference normalization, 8-12 s maximum with 1 s end fade. No synthetic piano substitute. Original acoustic tuning retained (author notes slight detuning).\n`, 'Public Domain');
  const manifest = JSON.parse(await readFile(new URL('fluid-ensemble/manifest.json', root), 'utf8'));
  await bank('worship-textures', async save => {
    const roots = [36, 42, 48, 54, 60, 66, 72, 78, 84];
    for (const sampleSet of ['shimmer-pad', 'choir-bloom']) for (const [index, note] of roots.entries()) {
      const specs = sampleSet === 'shimmer-pad' ? [[89, 0, -0.5, 0.55], [95, 12, 0.65, 0.2], [92, 12, -0.65, 0.12]] : [[89, 0, -0.6, 0.5], [52, 0, 0.6, 0.32], [95, 12, 0, 0.1]];
      const parts = await Promise.all(specs.map(async ([program, octave, pan, gain]) => {
        const zone = manifest.zones.find(z => z.sampleSet === String(program) && note + octave >= z.keyRange[0] && note + octave <= z.keyRange[1]);
        return { zone, octave, pan, gain, encoded: (await readFile(new URL('../' + zone.url, root))).toString('base64') };
      }));
      const rendered = await page.evaluate(async ({ parts, note, rate, sampleSet }) => {
        const context = new OfflineAudioContext(2, rate * 9, rate);
        for (const [i, part] of parts.entries()) {
          const source = context.createBufferSource(), pan = context.createStereoPanner(), gain = context.createGain(), filter = context.createBiquadFilter();
          source.buffer = await context.decodeAudioData(Uint8Array.from(atob(part.encoded), c => c.charCodeAt(0)).buffer);
          source.loop = true; source.loopStart = part.zone.loop.start; source.loopEnd = part.zone.loop.end;
          source.playbackRate.value = 2 ** ((note + part.octave - part.zone.rootNote + (part.zone.tuningCents + (i - 1) * 4) / 100) / 12);
          pan.pan.value = part.pan; filter.type = 'lowpass'; filter.frequency.value = sampleSet === 'shimmer-pad' ? 7000 : 3800;
          gain.gain.setValueCurveAtTime(Float32Array.from({ length: 901 }, (_, j) => part.gain * (0.8 + 0.2 * Math.sin(j / 900 * Math.PI * 2 + i * 2))), 0, 9);
          source.connect(filter).connect(gain).connect(pan).connect(context.destination); source.start();
          if (sampleSet === 'shimmer-pad' && i > 0) {
            const delay = context.createDelay(1), echo = context.createGain(); delay.delayTime.value = 0.23 + i * 0.13; echo.gain.value = 0.32;
            pan.connect(delay).connect(echo).connect(context.destination);
          }
        }
        const audio = await context.startRendering();
        const result = [0, 1].map(c => {
          const input = audio.getChannelData(c), data = input.slice(0, rate * 8);
          for (let i = 0; i < rate; i++) { const t = i / (rate - 1); data[rate * 7 + i] = input[rate * 7 + i] * (1 - t) + input[i] * t; }
          data[data.length - 1] = data[rate]; return data;
        });
        let peak = 0; for (const channel of result) for (const value of channel) peak = Math.max(peak, Math.abs(value));
        return result.map(channel => Array.from(channel, value => value * 0.65 / peak));
      }, { parts, note, rate, sampleSet });
      await save(`${sampleSet}-${note}`, rendered, { sampleSet, rootNote: note, velocityRange: [1, 127],
        keyRange: [index === 0 ? 0 : note - 3, index === roots.length - 1 ? 127 : note + 2], loop: { start: 1, end: 8 } });
    }
  }, 'FluidR3 samples, Copyright (c) 2000-2002, 2008 Frank Wen, MIT.\nSource and conversion provenance: ../fluid-ensemble/SOURCE.json and ATTRIBUTION.txt.\nLiveKeys adaptation: offline stereo layered samples with slow movement. Shimmer combines warm pad, octave air, and octave glass with baked echoes; Choir Bloom combines warm pad, choir, and subtle octave air. 9 roots each, 22050 Hz PCM16, 7 s crossfaded loops. No live shimmer DSP.\n', 'MIT');
  await copyFile(new URL('fluid-ensemble/FluidR3-LICENSE.txt', root), new URL('worship-textures/FluidR3-LICENSE.txt', root));
  await copyFile(new URL('fluid-ensemble/WebAudioFont-LICENSE.txt', root), new URL('worship-textures/WebAudioFont-LICENSE.txt', root));
} finally { await browser.close(); await sf.close(); }
