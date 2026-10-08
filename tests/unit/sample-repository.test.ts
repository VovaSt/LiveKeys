import { afterEach, expect, it, vi } from 'vitest';
import { WebSampleRepository } from '../../src/audio-web/samples';
import type { SamplePackManifest } from '../../src/domain/models';
afterEach(() => vi.unstubAllGlobals());
const manifest: SamplePackManifest = { schemaVersion: 1, id: 'test', version: '1', license: 'test', demo: true,
  zones: ['a', 'a', 'b'].map((url, i) => ({ id: String(i), url, rootNote: 60, keyRange: [0, 127], velocityRange: [1, 127], gainDb: 0, tuningCents: 0 })) };
it('deduplicates decoded assets and retries only failed files', async () => {
  const decode = vi.fn(async () => ({ length: 48000, numberOfChannels: 2 }));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ArrayBuffer(8)))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(new ArrayBuffer(8)));
  vi.stubGlobal('fetch', fetcher);
  const repository = new WebSampleRepository({ decodeAudioData: decode } as unknown as BaseAudioContext, 'http://localhost/');
  await expect(repository.load(manifest)).rejects.toThrow('HTTP 503');
  expect(repository.pcmBytes).toBe(48000 * 2 * 4);
  const buffers = await repository.load(manifest);
  expect(buffers.size).toBe(2); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(decode).toHaveBeenCalledTimes(2); expect(repository.pcmBytes).toBe(48000 * 2 * 4 * 2);
  repository.clear(); expect(repository.pcmBytes).toBe(0);
});
it('rejects a decoded bank over budget before retaining it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))));
  const repository = new WebSampleRepository({ decodeAudioData: async () => ({ length: 1000, numberOfChannels: 2 }) } as unknown as BaseAudioContext,
    'http://localhost/', 100);
  await expect(repository.load(manifest)).rejects.toThrow('PCM budget'); expect(repository.pcmBytes).toBe(0);
});
