import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = '23ca907d4370a04fd89ca483a92915e4d6159ab9';
const directory = new URL('../sample-source/fluid/', import.meta.url);
await mkdir(directory, { recursive: true });
const programs = [48, 52, 61, 89, 90, 91, 92, 95];
const metadata = {};
for (const program of programs) {
  const filename = `${String(program).padStart(3, '0')}0_FluidR3_GM_sf2_file.js`;
  const url = `https://raw.githubusercontent.com/surikov/webaudiofontdata/${revision}/sound/${filename}`;
  const response = await fetch(url); if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const source = await response.text();
  // Parse only the exported data literal. Never execute downloaded JavaScript.
  const literal = source.slice(source.indexOf('={') + 1, source.lastIndexOf(';'))
    .replace(/^\s*\/\/[^\n]*/gm, '').replace(/'([A-Za-z0-9+/=]*)'/g, (_, value) => JSON.stringify(value))
    .replace(/([,{]\s*)([A-Za-z][A-Za-z0-9]*):/g, '$1"$2":');
  const data = JSON.parse(literal);
  metadata[program] = { url, sha256: createHash('sha256').update(source).digest('hex'), zones: [] };
  for (const [index, zone] of data.zones.entries()) {
    const { file, ...parameters } = zone;
    const bytes = Buffer.from(file, 'base64');
    const name = `${program}-${index}.audio`;
    await writeFile(new URL(name, directory), bytes);
    metadata[program].zones.push({ ...parameters, file: name });
  }
  console.log(program, data.zones.length, data.zones.map(z => `${z.keyRangeLow}-${z.keyRangeHigh}:${z.originalPitch},loop=${z.loopStart}-${z.loopEnd}@${z.sampleRate}`).join(' '));
}
await writeFile(new URL('source.json', directory), JSON.stringify({ revision, programs: metadata }, null, 2));
for (const [name, url] of [
  ['FluidR3-LICENSE.txt', 'https://raw.githubusercontent.com/musescore/MuseScore/deprecated_master/share/sound/FluidR3Mono_License.md'],
  ['WebAudioFont-LICENSE.txt', `https://raw.githubusercontent.com/surikov/webaudiofontdata/${revision}/LICENSE`]
]) {
  const response = await fetch(url); if (!response.ok) throw new Error(`License: ${response.status}`);
  await writeFile(new URL(name, directory), await response.text());
}
