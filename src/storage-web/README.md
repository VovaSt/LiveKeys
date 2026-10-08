IndexedPresetRepository використовує базу `live-keys`, структурну версію 1:
`presets` (keyPath id) і `meta` (окремі ключі draft/settings). Promise запису
завершується після transaction.oncomplete, а не request.onsuccess. Імпорт усіх
пресетів і перевірка місткості відбуваються в одній readwrite-транзакції.

Читання/запис валідуються domain/serialization; schema даних PerformancePreset 1
мігрує до 2 при читанні й записується як 2 при наступному збереженні. Версія
структури IndexedDB не дорівнює версії JSON. Збереження UI послідовні, чернетка
debounced 300 ms. При versionchange connection закривається; blocked/quota/errors
не приховуються. Немає прихованого fallback, який удає успішне збереження.

Cache Storage/service worker та offline reload — етап 4. IndexedDB-пресети
не означають готовності shell/семплів до запуску offline. HTTP-кеш не є гарантією offline.
