import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../public/samples/fluid-ensemble/', import.meta.url);
const hashes = JSON.parse(await readFile(new URL('SHA256.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
let pcm = 0;
for (const [name, hash] of Object.entries(hashes)) {
  const bytes = await readFile(new URL(name, root));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Checksum: ' + name);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt16LE(34) !== 16) throw new Error('Not PCM16 WAV');
  const rate = bytes.readUInt32LE(24), channels = bytes.readUInt16LE(22), frames = (bytes.length - 44) / channels / 2;
  pcm += frames * channels * 4;
  for (const zone of manifest.zones.filter(z => z.url.endsWith('/' + name))) {
    if (!(zone.loop.start >= 0 && zone.loop.end > zone.loop.start && zone.loop.end <= frames / rate)) throw new Error('Loop: ' + zone.id);
  }
}
for (const zone of manifest.zones) if (!hashes[zone.url.split('/').pop()]) throw new Error('Missing file: ' + zone.id);
for (const sampleSet of new Set(manifest.zones.map(z => z.sampleSet))) for (let note = 0; note < 128; note++) {
  const matches = manifest.zones.filter(z => z.sampleSet === sampleSet && note >= z.keyRange[0] && note <= z.keyRange[1]);
  if (matches.length !== 1) throw new Error(`Coverage: ${sampleSet}/${note}`);
}
if (pcm + 57544512 + 65 * 1048576 > 256 * 1048576) throw new Error('Combined PCM budget exceeded');
console.log(`FluidR3: ${Object.keys(hashes).length} files verified; ${(pcm / 1048576).toFixed(2)} MiB PCM; all key ranges and loops valid.`);
