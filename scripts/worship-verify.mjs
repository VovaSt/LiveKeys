import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
let total = 0;
for (const id of ['felt-piano', 'worship-textures']) {
  const root = new URL(`../public/samples/${id}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const hashes = JSON.parse(await readFile(new URL('SHA256.json', root), 'utf8'));
  let pcm = 0;
  for (const [file, hash] of Object.entries(hashes)) {
    const data = await readFile(new URL(file, root));
    if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('Checksum ' + file);
    if (data.toString('ascii', 0, 4) !== 'RIFF' || data.readUInt16LE(34) !== 16 || data.readUInt32LE(24) !== 22050) throw new Error('Format ' + file);
    const channels = data.readUInt16LE(22), frames = (data.length - 44) / channels / 2;
    pcm += frames * channels * 4;
    let peak = 0, energy = 0;
    for (let p = 44; p < data.length; p += 2) { const value = data.readInt16LE(p) / 32768; peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    if (peak > 0.72 || energy < 0.01) throw new Error('Invalid signal ' + file);
    for (const z of manifest.zones.filter(z => z.url.endsWith('/' + file))) if (z.loop) {
      if (z.loop.start < 0 || z.loop.end <= z.loop.start || z.loop.end > frames / 22050) throw new Error('Loop ' + file);
      for (let c = 0; c < channels; c++) {
        const start = data.readInt16LE(44 + (Math.round(z.loop.start * 22050) * channels + c) * 2);
        const end = data.readInt16LE(44 + ((Math.round(z.loop.end * 22050) - 1) * channels + c) * 2);
        if (Math.abs(start - end) > 2) throw new Error('Loop discontinuity ' + file);
      }
    }
  }
  for (const z of manifest.zones) if (!hashes[z.url.split('/').pop()]) throw new Error('Missing zone asset');
  for (const set of new Set(manifest.zones.map(z => z.sampleSet))) for (let note = 0; note < 128; note++) for (const velocity of [1, 50, 51, 94, 95, 127]) {
    const matches = manifest.zones.filter(z => z.sampleSet === set && note >= z.keyRange[0] && note <= z.keyRange[1] && velocity >= z.velocityRange[0] && velocity <= z.velocityRange[1]);
    if (matches.length !== 1) throw new Error(`Coverage ${id}/${set}/${note}/${velocity}`);
  }
  total += pcm; console.log(`${id}: ${Object.keys(hashes).length} WAVs, ${(pcm / 1048576).toFixed(2)} MiB PCM; checksums, coverage, levels, loops passed`);
}
if (total > 65 * 1048576) throw new Error('New bank PCM budget exceeded');
