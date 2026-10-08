# Архітектура Live Keys · етапи 0–3

## Межі модулів

- domain: JSON-моделі, контракти, маршрутизація, velocity curves, MIDI normalization,
  валідація імпорту і міграція schema 1/2 → 3. Без Angular, AudioNode і DOM.
- audio-web: один AudioContext, семплер, PadVoice, окремі layer buses, preload,
  дедуплікація PCM, поліфонія й життєвий цикл. Без Angular.
- midi-web: явний дозвіл без SysEx, hot-plug/listener lifecycle і timestamps.
- storage-web: IndexedDB з transaction completion, атомарний імпорт, draft/settings.
- ui: standalone Angular, Signals конфігурації й telemetry раз на 100 ms,
  окремий компонент редактора шару. Не виконує аудіо через UI effects.

MIDI callback → normalizeMidi → NoteRouter → AudioEngine. Аудіо не залежить від
Angular change detection або requestAnimationFrame. Таймери UI обслуговують тільки
telemetry/autosave; аудіо планується за AudioContext.currentTime.

## Аудіограф

Звук інструмента → envelope → expression голосу → filter → chorus →
layer gain/pan → dry + post-fader sends → спільні reverb/delay →
3-band EQ → global master → stereo/mono crossfade → pre meter →
AudioWorklet limiter → post meter → системний вихід.

SampleVoice має 2 nodes, синтез 7 (FM 8), плюс expression Gain на кожен голос.
LayerEffectGraph спільний для голосів шару: low-pass/Q, stereo chorus із двома
modulated delays, gain/pan і sends. Reverb — Convolver з оригінальним детермінованим
noise-decay IR; delay має обмежений feedback ≤0.85 і low-pass у петлі.
EQ: lowshelf 180 Hz, peaking 1 kHz, highshelf 5 kHz. IR-пам’ять показується окремо.

Спільна пара reverb/delay не множиться на кількість голосів. Зміна decay замінює
wet graph із 50 ms fade; зберігаються не більше двох старих wet graphs. Cleanup
прив’язано до onended тихого buffer source, а не до UI-таймера. Panic завершує
голоси та старий wet graph за 8 ms, блокує sends на 12 ms від залишків голосів,
нові dry-ноти доступні відразу. Повний per-preset effect spillover — етап 4:
старі голоси поки проходять через актуальні спільні effects/EQ.

LimiterDSP у public/audio/limiter.js зв’язує канали, миттєво зменшує gain
за найбільшим sample peak і відновлює за 80 ms. Ceiling -12…-0.1 dBFS;
NaN/Infinity на вході перетворюються на нуль. Немає lookahead, це НЕ true-peak.
Під сильним overload можливі спотворення — слухова перевірка потрібна.
Meter є вибірковою telemetry; reduction передається worklet → UI приблизно 10 Hz.
Якщо AudioWorklet не завантажується, init закриває контекст і дозволяє retry,
не підміняючи захист неперевіреним fallback.

OutputGraph має stereo та mono branches зі згладженим crossfade. Mono
використовує speaker downmix 0.5L + 0.5R і дублює результат у два канали;
інтеграційний тест перевіряє рівень.

## Підготовка і ресурси

AudioContext init/resume — лише після жесту. latencyHint interactive є підказкою,
sampleRate береться з фактичного контексту. preparePreset валідує snapshot і
послідовно готує залежності. Лише пресети із sampler завантажують відповідний банк: 3V (48 MP3)
або legacy (30 MP3). Синтез не завантажує файлів. Повтор після помилки повторно використовує успішні
буфери. Один банк ділиться між усіма шарами/екземплярами.

prepare повертає унікальний instance token. activate виконується лише після
успішної підготовки; помилка зберігає чинний звук. Нові note-on отримують новий
instance, старі зберігають попередній. Максимум поточний + два попередні екземпляри;
найстаріший завершується 8 ms fade. Підготовлених, але не активованих snapshots
зберігається не більше чотирьох.

Buses окремі для instance/layer. Лічильники users охоплюють також короткі retiring
voices; непоточний bus від’єднується, коли users = 0. PCM не дублюється і залишається
під лімітом 256 MiB. При 48 kHz compact-банк займає 162 209 360 bytes ≈154,7 MiB.
Новий 3V-банк декодується окремим OfflineAudioContext у 22.05 kHz, усереднюється
в mono і peak-normalizes до 0.7. Займає 57 544 512 bytes ≈54,9 MiB; обидва банки
при 48 kHz разом 219 753 872 bytes ≈209,6 MiB. Декодування послідовне;
тимчасовий decoded buffer і mono-копія додаються до піку RAM, але не PCM-лічильника.
Це buffer.length × channels × 4, не загальний process RAM і не розмір MP3.

## Маршрутизація і редагування

Спершу enabled/mute/solo, input/channel та включені original key/velocity ranges.
Потім global transpose (поза 0–127 відкидається), velocity curve
linear/soft/hard/fixed=100, sampler-zone lookup. MIDI 60 відображається C4.
Будь-яка нота може потрапити до чотирьох шарів. Кілька Solo дозволені, mute перемагає.

VoiceIdentity зберігає input/channel/original note, instance, layer, actual pitch
і унікальний ID. Повторні note-on паруються FIFO; natural end/stealing лишає
порожню позицію до відповідного note-off. Інакше старий note-off міг би завершити
нове натискання. Черга обмежена 128 натисканнями одного input/channel/note.

Керування транспозицією шарів прибрано: legacy LayerConfig.transpose читається
для сумісності файлів, але NoteRouter його не додає до висоти. UI показує тільки
global transpose у шапці. Діапазони над клавіатурою будуються з keyRange та тієї
самої геометрії 88 клавіш, що використовується кнопками; вони не зсуваються
зі зміною висоти звуку. Mute є єдиним перемикачем тиші шару, також дозволяє
увімкнути шар зі старим enabled=false.

Редагування чинного пресету не є його повторною активацією. Gain/pan/cutoff
згладжуються; split/transpose/curve/fine tune та attack/release змінюють тільки
нові голоси. Mute, disable, solo-exclusion, видалення або зміна інструмента
плавно завершують відповідні поточні голоси й очищають їх з routing. Увімкнення
не породжує повторних note-on. Вимкнення sustain відпускає latched voices шару;
вже утримувані клавіші звучать до свого note-off.

CC64 окремий по входу/каналу: >=64 down, <64 up. CC123 поводиться як note-off
із повагою до sustain; CC120 завершує канал і скидає його педаль. Disconnect/deselect
зупиняє лише свій вхід. Blur/hidden очищує тільки локальні джерела. Аудіопереривання
скидає голоси та стан router; повернення до вкладки не відновлює старі ноти.

Mono використовує два IDs: запис натискання у FIFO і фізичний голос. Зміна
пріоритетної клавіші завершує попередній голос і запускає вибраний з glideFrom;
старий onended не видаляє історію утримуваних клавіш. Вибирається остання held,
інакше остання sustained; mute/instrument/mode edit видаляє історію цього шару.
Bend, CC1 і CC11 зберігаються по input/channel, застосовуються до чинних і нових
голосів. CC1 дає filter modulation та до 50 cents vibrato; bend має окремий
діапазон шару, CC11 можна вимкнути на шарі. Disconnect/Panic скидають контролери.

Синтез має profile із wave/ratio/detune/ADSR/cutoff/LFO/level. EP — двооператорний
FM: velocity змінює і gain, і modulation index, який затухає разом із атакою.
Це оригінальні синтезовані електропіано, не заявлена точна емуляція конкретної моделі.

## Поліфонія і час

64 голоси сумарно, опційно 32. Голос — нота одного шару, кількість nodes показується
окремо. Stealing: тихі release voices, потім найстаріші. Sample release 280 ms;
pad release налаштовується 0,05–10 s; fast stop 8 ms. Fade tails обмежені, onended
від’єднує nodes. При патологічному flood найстаріший надлишковий tail зупиняється
негайно; довільно великий потік не має гарантії відсутності клацань.

Domain/engine час — секунди аудіогодинника. Adapter обчислює різницю між MIDI
DOMHighResTimeStamp та performance.now(), додає до currentTime, прострочені
ноти затискає до now, а аномально майбутні — до now + 10 ms. Навмисного lookahead
немає. Panic скидає голоси/педаль, контекст лишається готовим до нових нот.

## Дані і локальне сховище

LayerEffects має додаткове поле rack: до двох унікальних { type, enabled }.
Воно зберігається в чернетках/пресетах/JSON. Domain валідує ліміт, дублікати й
типи, UI не є єдиним обмеженням. effectiveEffects перетворює bypass на нульові
sends / вимкнений chorus, не змінюючи збережені параметри. Filter має окремий
dry/wet bypass зі згладженим переходом: вимкнення справді оминає low-pass.
Master EQ також має bypass без втрати значень смуг; limiter лишається захистом виходу.
Старі schema 3 без rack мігрують за заповненими параметрами в порядку
Filter → Chorus → Reverb → Delay, максимум два. Числові параметри не видаляються.
Спільні reverb/delay лишаються спільними buses; картки містять їхні sends.
Макет UI не змінює MIDI/audio routing. Діалоги використовують native dialog:
фокус обмежено відкритим вікном, закриття повертає його кнопці виклику.

PerformancePreset і Backup schemaVersion 3. InstrumentPreset/Definition мають
власні версії (Natural Grand 2, legacy Grand 1), AppSettings schema 1.
Міграція 1/2 → 3 додає effects, mono/glide/expression/bend controls і зберігає
версію старого семплерного банку. Старі налаштування без outputMono отримують false. JSON містить тільки переносні дані/IDs/versions; AudioNode/AudioBuffer,
функції й sample base64 не серіалізуються.

IndexedDB structure version 1: presets (id) і meta (draft/settings). Валідація при
читанні та записі, queue UI-записів, draft debounce 300 ms, settings 200 ms. Запис
вважається успішним тільки після transaction.oncomplete. Помилки не приховуються
fallback-сховищем. versionchange закриває connection; blocked/quota показуються UI.

Factory preset при Save стає користувацькою копією; Save Copy має новий ID. Чернетка
окремо зберігає dirty flag. Master, outputMono, voice limit, global transpose і IDs MIDI-входів —
глобальні; recall пресету їх не змінює. Після reload MIDI-входи не перепризначаються
автоматично, користувач обирає їх знову після дозволу.

Backup містить format/schemaVersion, presets, settings, dependencies. Імпорт
додає лише нові копії presets, не застосовує globals із файла. Повна валідація
перед єдиною транзакцією: максимум 1 MiB/100 записів, 1–4 шари, ID uniqueness,
числові діапазони/finite, allowlist інструментів/версій/банків. Інструменти
відновлюються з локального каталогу; імпорт не може задати URL довільного коду
чи семплу. Максимум бібліотеки 99 пресетів + чернетка в експорті.

IndexedDB не забезпечує offline shell/assets. Service worker/Cache Storage —
етап 4. Негайне закриття до завершення запису та конфлікти кількох вкладок не
маскуються як гарантоване збереження; останній запис чернетки перемагає.

## Перевірені першоджерела

Стек лишився Angular 22.2.1 / TypeScript 6.0.3 / Node 24.21.0, точні залежності
в lockfile; етап 3 не додає npm-пакетів. Звірено 2026-10-06:

- [Angular compatibility](https://angular.dev/reference/versions)
- [Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- [AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)
- [OscillatorNode](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode)
- [AudioParam cancellation](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/cancelAndHoldAtTime)
- [AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode)
- [ConvolverNode](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode)
- [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)

Немає backend, VST, ScriptProcessor, обов’язкового SharedArrayBuffer чи WASM.
Модель даних не залежить від хостингу. Деплой не налаштовано.

## Майбутній iPhone

Моделі/domain/assets можна повторно використовувати. Web Audio/Web MIDI
адаптери автоматично не переносяться. Окремий spike Core MIDI → AVAudioEngine
на фізичному iPhone має перевірити sustain, routes, interruptions, background
і latency без обов’язкового JS bridge на кожній ноті. Spike ще не виконано.
