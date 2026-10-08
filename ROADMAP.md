# План

## Етап 0 — реалізована технічна основа, hardware-перевірки відкриті

- [x] Перевірені Web Audio/Web MIDI й сумісний Angular/TypeScript/Node.
- [x] Модульні межі та контракти, один AudioContext, MIDI → sampler → audio.
- [x] Ліцензований компактний demo-банк і оцінка пам’яті кандидата з velocity layers.
- [x] Sustain, 32/64 voices, identity/FIFO, stealing, disconnect/Panic.
- [ ] Фізичний MIDI → аудіо, latency, оцінка звуку на Windows і macOS.

## Етап 1 — перший зріз

- [x] Start/resume, один рояль/шар, вибір кількох MIDI-входів, активність/hot-plug.
- [x] CC64, CC120, CC123, master зі smoothing, Panic, screen/multi-touch keys.
- [x] Явні loading/error/retry/unsupported/denied states, діагностика PCM/latency.
- [x] Тести domain, OfflineAudioContext/E2E, build, CI й документація.
- [ ] Ручне приймання на фізичному обладнанні за TESTING.md.

## Етап 2 — шари та власні пресети

- [x] До 4 шарів, рояль або базовий Warm Pad у кожному.
- [x] Key/velocity ranges, curves, transpose/global transpose, fine tune, gain/pan, mute/solo, channel/input filter, sustain enable.
- [x] Pad synth: два осцилятори, ADSR, low-pass; gain/pan/cutoff smoothing.
- [x] Облік старих голосів при редагуванні, FIFO, відпускання muted/removed voices.
- [x] Пресети/копії/перейменування/видалення, чернетка, окремі глобальні settings в IndexedDB.
- [x] Versioned JSON, schema 1 → 2, валідація й атомарний імпорт нових копій.
- [x] Unit та браузерні тести, документація; додаткових npm-залежностей немає.
- [ ] Фізична перевірка чотирьох шарів, педалі й редагування під час гри.

Користувач підтвердив, що базовий зріз працює. Конфігурацію обладнання й окремі
вимірювання не надано; це не замінює задокументоване hardware-приймання.

## Етап 3 — бібліотека та ефекти реалізовані, слухове приймання відкрите

- [x] 25 тембрів: 3 sampled grand, 3 FM electric, 10 pads, 5 leads, 4 явно позначені Extra.
- [x] 6 performance presets, каталог, доступний loading/error/retry банків.
- [x] 3 записані velocity шари: compact 16 roots, mono 22.05 kHz, 54,9 MiB PCM.
- [x] Filter/chorus шарів, post-fader sends, спільні reverb/delay, tap/sync, EQ.
- [x] Linked sample-peak AudioWorklet limiter із ceiling/reduction; Panic очищує хвости.
- [x] Mono/poly lead, last-note return/glide, 14-bit bend, CC1 vibrato/filter, scoped CC11.
- [x] Глобальний stereo/mono output з компенсацією; schema 1/2 → 3, сумісність legacy bank.
- [x] Unit/OfflineAudioContext/E2E, перевірки ліцензійних повідомлень і SHA256 обох банків.
- [ ] Прослуховування 25 тембрів, границь velocity/зон рояля та остаточне gain matching.
- [ ] Фізичні wheels/CC11/педаль, чотири шари з ефектами, macOS, latency/30 хвилин.

Числа: завдання перелічує 21 тембр, але вимагає 25; додано 4 Extra.
3V-банк залишено demo через mono/downsample і рідше семплювання. Лімітер не true-peak.
Тести сигналів не зараховуються як музичне або hardware-приймання.

## Наступні етапи — не реалізовані

Окремо виконано запит на компактний UI: чотири колонки, desktop-екран без
прокрутки, повзунки, додаткові налаштування в діалогах, до двох ефектів на шар
із додаванням/видаленням/on-off та базовими значеннями для нових тембрів.

4. Setlist, MIDI Learn, безпечні переходи зі spillover, Performance Mode,
   Cache Storage/service worker, offline reload, quota/recovery,
   30-хвилинна сесія з чотирма шарами на задокументованій машині.
5. Окремий native iPhone spike (Core MIDI/AVAudioEngine, route/interruption/latency).

Деплой — після вибору хостингу. Сценічний веб-MVP ще не оголошено готовим.
