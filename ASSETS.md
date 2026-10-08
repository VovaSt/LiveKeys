# Аудіоматеріали

## Очищення бібліотеки · 2026-10-07

Поточний стан: 29 тембрів, 4 банки, 194 buffers, 155 298 016 bytes
(148,10 MiB) PCM. За дозволом користувача видалено salamander-compact,
Prism Pulse та сирі набори FluidR3 88/93/94 — загалом 30 MP3 і 16 WAV.
FluidR3 тепер має 80 WAV, 29,63 MiB PCM. Ліцензійне повідомлення Salamander
перенесено до `salamander-3v/UPSTREAM-README.txt`; атрибуцію збережено.
Решта цього документа описує походження та історію попередніх версій;
згадки Legacy і 240 buffers нижче не описують поточну поставку.

## Worship-оновлення · 2026-10-07

**Felt Piano — Fuchs & Möhr, Tom Guder.** Автор прямо оголосив SF2 і WAV
Public Domain у своєму повідомленні:
https://www.polyphone.io/en/forum/your-creations/850-acoustic-felt-piano-upright-fuchs-mohr
Це не семпли Spitfire чи іншої закритої бібліотеки.
Вихідний SF2: https://drive.google.com/file/d/1NCaVdQQyK4YbbA9ztrkBQYN8jpvbcQDG/view
SHA-256: `cf6fdb8ff22a61732364659b341539ad4806d96616fb718917238bcd37bebc7f`.
48 WAV: 16 опорних нот A0–C8 × три записані динаміки p/m/f; key mapping покриває MIDI 0–127.
Адаптація: mono downmix, 22050 Hz PCM16, 15 Hz DC-фільтр, peak normalization,
обмеження довжини 8–12 с із фінальним fade 1 с. PCM 39,37 MiB.
Автор зазначає нерівність строю; оригінальний стрій збережено. Придатність у
поєднанні з командою **потребує перевірки на слух**. Half-pedal і release samples відсутні.

**Shimmer Pad / Choir Bloom:** власні offline-комбінації готових семплів FluidR3,
Frank Wen, MIT, з раніше включеного WebAudioFont-data subset. Джерело зафіксоване
revision `23ca907d4370a04fd89ca483a92915e4d6159ab9`:
https://github.com/surikov/webaudiofontdata/tree/23ca907d4370a04fd89ca483a92915e4d6159ab9
Shimmer: теплий пед + октавні air/glass + записані echoes; Choir Bloom:
теплий пед + хор + тихий октавний air. По 9 кореневих нот, стерео, 22050 Hz,
8 с запису, цикл 1–8 с із crossfade. PCM разом 24,22 MiB. Це адаптовані
семпли, не стороння готова worship-бібліотека. Ліцензії обох авторів конверсії
збережено поруч із файлами. Offline build: `scripts/worship-build.mjs`.

Каталог містить 29 доступних тембрів; старі тембри залишено для сумісності.
Legacy Salamander тепер декодується у 22050 Hz mono, щоб усі п’ять банків
поміщалися в попередній бюджет 256 MiB. Перевірено всі 240 buffers разом:
199 529 328 bytes (190,29 MiB) PCM. Наведені нижче старі вимірювання 48 kHz
описують попередню версію. Усі нові файли мають manifest, SHA256 та атрибуцію.

## Включений банк: salamander-compact, version 1 (demo)

Автор записів — **Alexander Holm**, Salamander Grand Piano, Yamaha C5.
Першоджерело: https://archive.org/details/SalamanderGrandPianoV3

Джерело конкретних MP3:
https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander

Upstream README має заголовок V2 і changelog V3; не приписуємо цим MP3
точний velocity-layer чи однозначну версію оригінального великого банку.
Відтворюваність нашого пакета визначає commit і SHA256.json.

Ліцензія: **CC BY 3.0 Unported**, прямо в upstream README.
https://creativecommons.org/licenses/by/3.0/ і
https://creativecommons.org/licenses/by/3.0/legalcode

Дозволяє копіювання, модифікацію та розповсюдження, зокрема комерційне,
за умови атрибуції/ліцензійного повідомлення й відповідного позначення змін.
Обмеження: не приписувати схвалення автором, не накладати додаткові заборони
на ці матеріали. При майбутньому mobile bundle зберегти атрибуцію й доступ до
ліцензії; не поширювати обмеження застосунку на відкриті семпли.

Включено 30 незмінених MP3 A0–C8 через малу терцію. Upstream конвертував
записи у MP3; наші зміни — добір файлів, key mapping, velocity-to-gain і envelope.
Файли `UPSTREAM-README.txt`, `ATTRIBUTION.txt`, `SHA256.json`, `manifest.json`
зберігаються поряд із samples і копіюються у статичну збірку. Атрибуція доступна з UI.
Перевірено ліцензійне повідомлення 2026-10-06; це не матеріали Sunday Keys/Kontakt.

**Обмеження demo:** один записаний рівень динаміки. Немає release samples,
half-pedaling/resonance. За межами A0–C8 застосовується транспонування крайніх зон;
якість екстремальних MIDI нот не оголошується релізною. Оцінка тембру на слух
**потребує ручної перевірки**.

## Новий банк: salamander-3v, version 1 (compact demo)

48 MP3: 16 опорних нот A0–C8 (переважно через 6 півтонів), записані velocity
v4 / v9 / v15. Джерело:
https://github.com/tambien/Piano/tree/0cd2c034f820c53e83ab22f5c13bd490b9e4de85/audio
README цього проєкту посилається на оригінальний Salamander Grand Piano.
Ліцензія записів — та сама CC BY 3.0 Alexander Holm; код upstream Piano не включено.

MP3-байти не змінено, хвости не обрізано. Runtime: decode 22.05 kHz, середнє
каналів у mono, peak normalization до 0.7. Velocity ranges: 1–50, 51–95, 96–127;
gain залежить від velocity. Natural/Soft/Bright Grand — тональні варіанти одного
банку, з різним low-pass та початковими рівнями, а не три окремі роялі.
Мапінг для кожного MIDI key/velocity перевірено без пропусків і накладань.

Повний оригінал має щільніше семплювання й 16 velocity layers. Компактна версія
не претендує на цю якість. Переходи зон/динаміки, mono-сумування, шум тихих хвостів,
gain matching та придатність для виступу **потребують прослуховування**.
Немає release samples, half-pedal або симпатичного резонансу.

Відтворення: scripts/piano-3v.mjs, pinned commit, SHA256.json і manifest.
ATTRIBUTION.txt позначає добір, downsample, mono та нормалізацію; оригінальне
ліцензійне повідомлення збережене в salamander-compact/UPSTREAM-README.txt.
Обидва банки та атрибуція копіюються у build; npm run samples:verify перевіряє
78 MP3. Для mobile redistribution зберегти всі повідомлення.

## Виміряна пам’ять, Chromium 48 kHz · 2026-10-06

| Банк | Buffers | PCM bytes | MiB |
| --- | --- | --- | --- |
| salamander-3v (фіксований decode 22050 mono) | 48 | 57 544 512 | 54,9 |
| salamander-compact (decode 48000 stereo) | 30 | 162 209 360 | 154,7 |
| Разом | 78 | 219 753 872 | 209,6 |

Це buffer.length × channels × 4, не весь RAM процесу. Legacy-банк залежить від
частоти контексту; при високих rates спільне завантаження може перевищити
256 MiB і завершитися видимою помилкою. Уже підготовлений звук зберігається.
Новий банк має фіксований decode rate. Транзитний decode і IR додаються до RAM.

## Синтез і IR

3 електропіано — оригінальний FM-синтез із velocity-залежним індексом і спадом
яскравості: Warm Tine (ratio 1), Bright Tine (ratio 3), Soft Reed (triangle,
ratio 2). Обрано синтез, щоб забезпечити різну динаміку без додаткового
неперевіреного банку й завантажень. Це не точні моделі історичних інструментів.

10 педів і 5 лідів використовують субтрактивний синтез, ADSR, detune, low-pass
та LFO. Чотири додаткові варіації явно позначено Extra: Bell Keys, Velvet, Pulse,
Octave Air. Названий перелік у завданні містить 21 інструмент, тому ці доповнення
доводять каталог до потрібних 25.

Reverb IR генерується власним deterministic noise-decay алгоритмом у effects.ts.
Сторонніх IR, додаткових записів чи запозиченого DSP-коду немає. Відмінність
сигналів та velocity перевіряється автоматично, а музична якість і остаточне
узгодження гучності всіх тембрів **потребують ручної перевірки**.
