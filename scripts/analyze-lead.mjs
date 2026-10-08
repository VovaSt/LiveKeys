import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const data = await readFile(process.argv[2]);
  console.log(JSON.stringify(await page.evaluate(async base64 => {
    const ctx = new OfflineAudioContext(1, 1, 22050);
    const buffer = await ctx.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer);
    const x = buffer.getChannelData(0), sr = buffer.sampleRate;
    const frames = [];
    for (let t = 0.1; t < Math.min(buffer.duration, 7); t += 0.4) {
      const start = Math.floor(t * sr), n = 4096;
      if (start + n >= x.length) break;
      const peaks = [];
      for (let k = 12; k < 1000; k++) {
        let re = 0, im = 0;
        for (let j = 0; j < n; j++) {
          const v = x[start + j] * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / (n - 1)));
          re += v * Math.cos(2 * Math.PI * k * j / n); im -= v * Math.sin(2 * Math.PI * k * j / n);
        }
        peaks.push({ hz: Math.round(k * sr / n), power: re * re + im * im });
      }
      peaks.sort((a,b) => b.power - a.power);
      const selected = [];
      for (const p of peaks) if (selected.every(q => Math.abs(p.hz - q.hz) > 35) && selected.length < 10) selected.push(p);
      frames.push({ t: +t.toFixed(1), rms: Math.sqrt(x.slice(start,start+n).reduce((s,v) => s+v*v,0)/n), peaks: selected.map(p=>[p.hz, Math.round(10*Math.log10(p.power/peaks[0].power))]) });
    }
    return { duration: buffer.duration, channels: buffer.numberOfChannels, frames };
  }, data.toString('base64')), null, 2));
} finally { await browser.close(); }
