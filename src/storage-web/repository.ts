import type { PresetRepository } from '../domain/contracts';
import type { AppSettings, PerformancePreset } from '../domain/models';
import { createLayer, instruments } from '../domain/models';
import { DataError, parsePreset, parseSettings } from '../domain/serialization';
export interface Draft { preset: PerformancePreset; dirty: boolean }
/** Resolves writes only on transaction completion, including quota/abort errors. */
export class IndexedPresetRepository implements PresetRepository {
  private connection?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('live-keys', 4);
      let abandoned = false;
      request.onupgradeneeded = event => {
        if (event.oldVersion === 0) {
          request.result.createObjectStore('presets', { keyPath: 'id' });
          request.result.createObjectStore('meta');
        } else if (event.oldVersion < 3) {
          // User-authorized one-time library reset; future saves survive reloads.
          request.transaction!.objectStore('presets').clear();
          request.transaction!.objectStore('meta').delete('draft');
        } else {
          // Preserve new user presets; replace the retired instrument in their data.
          const replaceBell = (preset: PerformancePreset): void => {
            for (const layer of preset.layers ?? []) if (layer.instrument?.id === 'bell-keys') {
              const defaults = createLayer(layer.id, instruments.find(i => i.id === 'rhodes')!);
              layer.instrument = defaults.instrument; layer.pad = defaults.pad;
            }
          };
          const cursor = request.transaction!.objectStore('presets').openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result) return;
            const preset = cursor.result.value as PerformancePreset;
            replaceBell(preset); cursor.result.update(preset); cursor.result.continue();
          };
          const meta = request.transaction!.objectStore('meta'), draft = meta.get('draft');
          draft.onsuccess = () => {
            const value = draft.result as Draft | undefined;
            if (!value) return;
            if (value.preset.id.startsWith('worship-') && !value.dirty) meta.delete('draft');
            else { replaceBell(value.preset); meta.put(value, 'draft'); }
          };
        }
      };
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return; }
        const db = request.result;
        db.onversionchange = () => { db.close(); this.connection = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { abandoned = true; reject(new Error('STORAGE_BLOCKED')); };
    }).catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }
  private async read(store: string, key?: string): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly');
      const request = key === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('STORAGE_ABORTED'));
      transaction.onerror = () => reject(transaction.error);
    });
  }
  private async write(store: string, action: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('STORAGE_ABORTED'));
      transaction.onerror = () => reject(transaction.error);
      try { action(transaction.objectStore(store)); } catch (error) { transaction.abort(); reject(error); }
    });
  }
  async list(): Promise<PerformancePreset[]> {
    const data = await this.read('presets');
    if (!Array.isArray(data)) throw new Error('STORAGE_INVALID');
    return data.map(parsePreset).sort((a, b) => a.name.localeCompare(b.name));
  }
  async save(preset: PerformancePreset): Promise<void> { await this.saveMany([preset]); }
  async saveMany(presets: PerformancePreset[]): Promise<void> {
    const validated = presets.map(parsePreset);
    if (validated.length > 99) throw new DataError('size');
    // Read keys and add the batch in the SAME transaction: capacity failures cannot partially import.
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('presets', 'readwrite'), store = transaction.objectStore('presets');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('STORAGE_ABORTED'));
      transaction.onerror = () => reject(transaction.error);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        if (new Set([...keys.result, ...validated.map(p => p.id)]).size > 99) { reject(new DataError('size')); transaction.abort(); return; }
        try { for (const p of validated) store.put(p); } catch (error) { transaction.abort(); reject(error); }
      };
    });
  }
  async remove(id: string): Promise<void> { await this.write('presets', store => { store.delete(id); }); }
  async draft(): Promise<Draft | undefined> {
    const value = await this.read('meta', 'draft');
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || !('preset' in value) || !('dirty' in value) || typeof value.dirty !== 'boolean') throw new Error('STORAGE_INVALID');
    return { preset: parsePreset(value.preset), dirty: value.dirty };
  }
  async saveDraft(draft: Draft): Promise<void> {
    const value = { preset: parsePreset(draft.preset), dirty: draft.dirty };
    await this.write('meta', store => { store.put(value, 'draft'); });
  }
  async settings(): Promise<AppSettings | undefined> {
    const value = await this.read('meta', 'settings'); return value === undefined ? undefined : parseSettings(value);
  }
  async saveSettings(settings: AppSettings): Promise<void> {
    const value = parseSettings(settings); await this.write('meta', store => { store.put(value, 'settings'); });
  }
  async close(): Promise<void> { (await this.connection)?.close(); this.connection = undefined; }
}
