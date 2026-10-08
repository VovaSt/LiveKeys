import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = '0cd2c034f820c53e83ab22f5c13bd490b9e4de85';
const base = `https://raw.githubusercontent.com/tambien/Piano/${revision}/audio/`;
const directory = new URL('../public/samples/salamander-3v/', import.meta.url);
await mkdir(directory, { recursive: true });
const roots = [...Array.from({ length: 15 }, (_, i) => 21 + i * 6), 108];
const notes = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const dynamics = [{ source: 4, range: [1, 50] }, { source: 9, range: [51, 95] }, { source: 15, range: [96, 127] }];
const zones = roots.flatMap((rootNote, index) => dynamics.map(dynamic => {
  const id = `${notes[rootNote % 12]}${Math.floor(rootNote / 12) - 1}v${dynamic.source}`;
  return { id, url: `samples/salamander-3v/${id}.mp3`, rootNote,
    keyRange: [index === 0 ? 0 : Math.floor((roots[index - 1] + rootNote) / 2) + 1,
      index === roots.length - 1 ? 127 : Math.floor((rootNote + roots[index + 1]) / 2)],
    velocityRange: dynamic.range, tuningCents: 0, gainDb: 0 };
}));
const downloading = process.argv.includes('--fetch');
const hashUrl = new URL('SHA256.json', directory); let expected = {};
try { expected = JSON.parse(await readFile(hashUrl, 'utf8')); } catch { if (!downloading) throw new Error('Missing checksums'); }
const hashes = {};
for (let offset = 0; offset < zones.length; offset += 4) await Promise.all(zones.slice(offset, offset + 4).map(async zone => {
  const filename = `${zone.id}.mp3`, url = new URL(filename, directory);
  if (downloading) {
    const response = await fetch(base + filename, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${filename}: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (expected[filename] && createHash('sha256').update(data).digest('hex') !== expected[filename]) throw new Error(`Checksum: ${filename}`);
    await writeFile(url, data);
  }
  hashes[filename] = createHash('sha256').update(await readFile(url)).digest('hex');
  if (!downloading && hashes[filename] !== expected[filename]) throw new Error(`Checksum: ${filename}`);
}));
if (downloading) {
  await writeFile(hashUrl, JSON.stringify(hashes, null, 2) + '\n');
  await writeFile(new URL('manifest.json', directory), JSON.stringify({ schemaVersion: 1, id: 'salamander-3v', version: '1',
    license: 'CC-BY-3.0', demo: true, sourceRevision: revision, decodeSampleRate: 22050, mono: true, zones }, null, 2) + '\n');
}
console.log(`Verified ${zones.length} samples: 16 roots, original velocity layers 4 / 9 / 15.`);
