/**
 * leaderboards/core.js — host-agnostic ядро слоя лидербордов.
 *
 * Определяет публичный фасад и НИЧЕГО про конкретные хосты: каждый хост живёт в своём
 * соседнем файле и сам регистрируется здесь. Модалка со списком — тоже отдельный файл,
 * поэтому сборка, в которой лидербордов нет, не подключает ни адаптеров, ни ui.js —
 * и все методы фасада всё равно отвечают безопасно.
 *
 * Публичный контракт: window.GameLeaderboards
 *   GameLeaderboards.boards                     // { endless: 'имя', adventure: 'имя' }
 *   GameLeaderboards.provider()                 // имя активного адаптера или 'none'
 *   GameLeaderboards.isAvailable()
 *   GameLeaderboards.needsAuth() / requestAuth()
 *   GameLeaderboards.submit(key, score, extra)   // Promise<boolean>, тихо игнорит отсутствие хоста
 *   GameLeaderboards.fetch(key, options)         // Promise<{ entries, playerEntry } | null>
 *   GameLeaderboards.openUi(key) / closeUi() / isOpen()
 *   GameLeaderboards.applyLanguage(lang)
 *
 * Два борда: 'endless' — рекорд классики, 'adventure' — суммарные звёзды приключения.
 * ВАЖНО: имена бордов должны быть заведены в консоли разработчика хоста (техническое
 * название), иначе запись результата вернётся ошибкой. Ядро только передаёт имя дальше.
 *
 * Контракт регистрации — window.GameLeaderboardsRegistry.register(adapter):
 *
 *   name        string   — его отдаёт provider()
 *   priority    number   — меньше = спрашиваем раньше; при равенстве решает порядок
 *                          регистрации, то есть порядок <script> в сборке.
 *   available   ()->bool ЕСТЬ ЛИ ХОСТ ПРЯМО СЕЙЧАС. Спрашивается на КАЖДОМ вызове и
 *                        никогда не кэшируется: хост появляется позже нас (его SDK
 *                        подключают отдельным скриптом) и может пропасть.
 *   submit      (board, score, extra) -> Promise
 *                        resolve(false) = «не смог» (не тот борд, лимит, сети нет), и
 *                        тогда ядро пробует следующий адаптер; любой другой результат
 *                        считается записью. Бросать исключение можно: ядро поймает,
 *                        напишет предупреждение и тоже пойдёт к следующему.
 *   fetch       (board, options) -> Promise<Array|null>
 *                        массив УЖЕ нормализованных записей (пустой массив = борд пуст,
 *                        это валидный ответ) либо null = «не мой борд / не смог», и тогда
 *                        очередь уходит следующему адаптеру. Отказ (reject) ядро НЕ
 *                        глушит — его ловит модалка и показывает кнопку «Ещё раз»;
 *                        адаптер, который хочет молча уступить, резолвит null.
 *   needsAuth   ()->bool           опционально
 *   requestAuth ()->Promise<bool>  опционально
 *
 * Нормализованная запись (её собирает адаптер, форму знает модалка):
 *   { rank, score, formattedScore, name, photo, extraData, isPlayer }
 *
 * Контракт регистрации UI — registerUi(ui):
 *   open(key) / close() / isOpen() / applyLanguage(lang)
 * Без него openUi/closeUi/applyLanguage — no-op, а isOpen() — false.
 */
(function () {
    'use strict';

    const BOARDS = {
        endless: 'blockChpock',
        adventure: 'blockChpockAdventure'
    };

    const DEFAULT_FETCH_OPTIONS = {
        quantityTop: 10,
        includeUser: true,
        quantityAround: 3
    };

    const adapters = [];
    let ui = null;

    function byPriority(a, b) {
        return (a.priority || 0) - (b.priority || 0);
    }

    function register(adapter) {
        if (!adapter || typeof adapter.available !== 'function') return;
        adapters.push(adapter);
        adapters.sort(byPriority);
    }

    function registerUi(impl) {
        if (impl && typeof impl.open === 'function') ui = impl;
    }

    // Хост разрешается заново на каждом вызове, а не один раз при загрузке: его SDK
    // подключают отдельным скриптом уже после нас, и он же может исчезнуть между двумя
    // обращениями. Поэтому ни pick(), ни provider() ничего не запоминают.
    function pick(capability) {
        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a[capability] !== 'function') continue;
            if (!a.available()) continue;
            return a;
        }
        return null;
    }

    function provider() {
        for (let i = 0; i < adapters.length; i++) {
            if (adapters[i].available()) return adapters[i].name || 'unknown';
        }
        return 'none';
    }

    function isAvailable() {
        return provider() !== 'none';
    }

    function boardName(key) {
        return BOARDS[key] || BOARDS.endless;
    }

    // Часть хостов требует авторизации, чтобы записать результат (чтение обычно открыто
    // всем). Оба метода опциональны: адаптер, который их не предоставил, означает «вход
    // не нужен» — ядро отвечает false / ничего не делает, и модалка не рисует ряд входа.
    function needsAuth() {
        const a = pick('needsAuth');
        if (!a) return false;
        try { return !!a.needsAuth(); } catch (e) { return false; }
    }

    function requestAuth() {
        const a = pick('requestAuth');
        if (!a) return Promise.resolve(false);
        try {
            return Promise.resolve(a.requestAuth()).then(value => !!value, () => false);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    // ------------------------------------------------------------------
    // Запись результата
    // ------------------------------------------------------------------
    // Никогда не бросает: вызывающий код (game.js/adventure.js) дергает submit
    // «в никуда», без await и без catch — отсутствие хоста не должно шуметь в консоли.
    async function submit(key, score, extraData) {
        try {
            const numericScore = Math.floor(Number(score));
            if (!Number.isFinite(numericScore) || numericScore < 0) return false;

            const name = boardName(key);
            const extra = (extraData && typeof extraData === 'object')
                ? JSON.stringify(extraData)
                : (typeof extraData === 'string' ? extraData : null);

            for (let i = 0; i < adapters.length; i++) {
                const a = adapters[i];
                if (typeof a.submit !== 'function' || !a.available()) continue;

                try {
                    // Хост не обязан бросать исключение на отказ — он может просто
                    // зарезолвить false (борд не тот, лимит, сети нет), поэтому смотрим
                    // на результат и в этом случае отдаём попытку следующему адаптеру.
                    const ok = await a.submit(name, numericScore, extra);
                    if (ok !== false) return true;
                } catch (error) {
                    console.warn('[leaderboards] ' + (a.name || 'adapter') + ' submit failed', error);
                }
            }

            return false;
        } catch (error) {
            console.warn('[leaderboards] submit failed', error);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Чтение результатов
    // ------------------------------------------------------------------
    async function fetch(key, options) {
        const name = boardName(key);
        const opts = Object.assign({}, DEFAULT_FETCH_OPTIONS, options || {});

        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a.fetch !== 'function' || !a.available()) continue;

            // Отказ адаптера сознательно не глушим (см. контракт в шапке): рухнувший
            // запрос и пустой борд — разные вещи, и различает их вызывающая сторона.
            const list = await a.fetch(name, opts);
            if (!Array.isArray(list)) continue;

            return { entries: list, playerEntry: list.find(e => e.isPlayer) || null };
        }

        return null;
    }

    // ------------------------------------------------------------------
    // UI. Модалка — отдельный файл; там, где её нет, все четыре метода обязаны быть
    // безобидными. Особенно openUi: заглушка НЕ трогает блокировку ввода, иначе в
    // сборке без модалки поле осталось бы заблокированным навсегда и игра встала бы.
    // ------------------------------------------------------------------
    function openUi(key) {
        if (!ui) return;
        ui.open(key);
    }

    function closeUi() {
        if (ui && typeof ui.close === 'function') ui.close();
    }

    function isOpen() {
        return !!(ui && typeof ui.isOpen === 'function' && ui.isOpen());
    }

    function applyLanguage(lang) {
        if (ui && typeof ui.applyLanguage === 'function') ui.applyLanguage(lang);
    }

    window.GameLeaderboardsRegistry = {
        register: register,
        registerUi: registerUi
    };

    window.GameLeaderboards = {
        boards: BOARDS,
        provider: provider,
        isAvailable: isAvailable,
        needsAuth: needsAuth,
        requestAuth: requestAuth,
        submit: submit,
        fetch: fetch,
        openUi: openUi,
        closeUi: closeUi,
        isOpen: isOpen,
        applyLanguage: applyLanguage
    };

    // Файлы адаптеров и модалки — обычные <script> после этого, так что к моменту, когда
    // текущая задача уступит поток, все уже зарегистрировались. Микротаска — самый ранний
    // безопасный момент, чтобы одной строкой увидеть, с чем собрали билд.
    Promise.resolve().then(() => {
        console.log('[leaderboards] facade ready (provider=' + provider()
            + ', adapters=' + adapters.length + ', ui=' + !!ui + ').');
    });
})();
;
/**
 * leaderboards/ui.js — модалка со списком лидеров: вёрстка, i18n (EN/RU) и загрузка.
 *
 * Собирается в JS и живёт целиком внутри этого файла — index.html про неё ничего не
 * знает, стили лежат в styles.css (классы lb-*). Регистрируется в ядре как поставщик
 * UI, поэтому сборка без лидербордов просто не подключает этот файл: ядро остаётся с
 * no-op openUi/closeUi/applyLanguage и не блокирует ввод.
 *
 * С хостом файл не разговаривает вообще: доступность, чтение борда и вход — только
 * через window.GameLeaderboards, то есть через ядро и его активный адаптер.
 */
(function () {
    'use strict';

    const I18N = {
        en: {
            title: 'Leaderboard',
            tabEndless: 'Classic',
            tabAdventure: 'Adventure',
            loading: 'Loading…',
            empty: 'No results yet — be the first!',
            unavailable: 'Leaderboards are not available here.',
            authTitle: 'Sign in to join the ranking',
            authBtn: 'Sign in',
            close: 'Close',
            you: 'You',
            starsUnit: '★',
            levelShort: 'Lv.',
            retry: 'Retry'
        },
        ru: {
            title: 'Лидеры',
            tabEndless: 'Классика',
            tabAdventure: 'Приключение',
            loading: 'Загружаем…',
            empty: 'Пока нет результатов — будь первым!',
            unavailable: 'Здесь лидерборды недоступны.',
            authTitle: 'Войди, чтобы попасть в рейтинг',
            authBtn: 'Войти',
            close: 'Закрыть',
            you: 'Вы',
            starsUnit: '★',
            levelShort: 'Ур.',
            retry: 'Ещё раз'
        }
    };

    let language = 'ru';
    let overlayEl = null;
    let listEl = null;
    let titleEl = null;
    let authRowEl = null;
    let tabButtons = {};
    let activeBoardKey = 'endless';
    let fetchToken = 0;

    function messages() {
        return I18N[language] || I18N.en;
    }

    function normalizeLanguage(lang) {
        return (typeof lang === 'string' && lang.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
    }

    // Ядро — единственный вход к хосту. Берём его по месту вызова, а не при загрузке:
    // порядок <script> внутри слоя может меняться от сборки к сборке.
    function core() {
        return window.GameLeaderboards || null;
    }

    function boards() {
        const lb = core();
        return (lb && lb.boards) || {};
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------
    function buildUi() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.className = 'lb-overlay';
        overlayEl.id = 'leaderboard-overlay';
        overlayEl.setAttribute('aria-hidden', 'true');

        const panel = document.createElement('div');
        panel.className = 'lb-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        const header = document.createElement('div');
        header.className = 'lb-header';

        titleEl = document.createElement('h2');
        titleEl.className = 'lb-title';
        header.appendChild(titleEl);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lb-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', closeUi);
        header.appendChild(closeBtn);

        panel.appendChild(header);

        const tabs = document.createElement('div');
        tabs.className = 'lb-tabs';
        tabButtons = {};

        Object.keys(boards()).forEach(key => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'lb-tab';
            tab.dataset.board = key;
            tab.addEventListener('click', () => openUi(key));
            tabs.appendChild(tab);
            tabButtons[key] = tab;
        });

        panel.appendChild(tabs);

        listEl = document.createElement('div');
        listEl.className = 'lb-list';
        panel.appendChild(listEl);

        authRowEl = document.createElement('div');
        authRowEl.className = 'lb-auth';
        authRowEl.hidden = true;
        panel.appendChild(authRowEl);

        overlayEl.appendChild(panel);
        overlayEl.addEventListener('pointerdown', event => {
            if (event.target === overlayEl) closeUi();
        });

        document.body.appendChild(overlayEl);
    }

    function renderTabs() {
        const text = messages();
        const labels = { endless: text.tabEndless, adventure: text.tabAdventure };

        Object.keys(tabButtons).forEach(key => {
            const tab = tabButtons[key];
            tab.textContent = labels[key] || key;
            tab.classList.toggle('lb-tab-active', key === activeBoardKey);
        });
    }

    function renderStatus(message, actionLabel, action) {
        listEl.innerHTML = '';

        const status = document.createElement('div');
        status.className = 'lb-status';
        status.textContent = message;
        listEl.appendChild(status);

        if (actionLabel && typeof action === 'function') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lb-action';
            btn.textContent = actionLabel;
            btn.addEventListener('click', action);
            listEl.appendChild(btn);
        }
    }

    function formatScore(entry) {
        const text = messages();

        if (activeBoardKey === 'adventure') {
            let levelPart = '';
            try {
                const extra = entry.extraData ? JSON.parse(entry.extraData) : null;
                if (extra && extra.level) levelPart = ` · ${text.levelShort} ${extra.level}`;
            } catch (e) { /* extraData не наш — просто не показываем уровень */ }
            return `${text.starsUnit} ${entry.score}${levelPart}`;
        }

        return entry.formattedScore || String(entry.score);
    }

    function renderEntries(entries) {
        const text = messages();
        listEl.innerHTML = '';

        if (!entries.length) {
            renderStatus(text.empty);
            return;
        }

        entries.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'lb-row';
            if (entry.isPlayer) row.classList.add('lb-row-self');

            const rank = document.createElement('span');
            rank.className = 'lb-rank';
            rank.textContent = `${entry.rank}`;
            row.appendChild(rank);

            const avatar = document.createElement('span');
            avatar.className = 'lb-avatar';
            if (entry.photo) {
                avatar.style.backgroundImage = `url(${entry.photo})`;
            } else {
                avatar.classList.add('lb-avatar-empty');
            }
            row.appendChild(avatar);

            const name = document.createElement('span');
            name.className = 'lb-name';
            name.textContent = entry.isPlayer ? (entry.name || text.you) : (entry.name || '—');
            row.appendChild(name);

            const score = document.createElement('span');
            score.className = 'lb-score';
            score.textContent = formatScore(entry);
            row.appendChild(score);

            listEl.appendChild(row);
        });
    }

    // Ряд входа существует только там, где активный адаптер вообще умеет авторизацию:
    // без needsAuth/requestAuth ядро отвечает false, и ряд остаётся скрытым.
    function renderAuthRow() {
        const text = messages();
        const lb = core();

        if (!authRowEl) return;

        if (!lb || typeof lb.needsAuth !== 'function' || !lb.needsAuth()) {
            authRowEl.hidden = true;
            authRowEl.innerHTML = '';
            return;
        }

        authRowEl.hidden = false;
        authRowEl.innerHTML = '';

        const hint = document.createElement('span');
        hint.className = 'lb-auth-hint';
        hint.textContent = text.authTitle;
        authRowEl.appendChild(hint);

        const authBtn = document.createElement('button');
        authBtn.type = 'button';
        authBtn.className = 'lb-action';
        authBtn.textContent = text.authBtn;
        authBtn.addEventListener('click', async () => {
            authBtn.disabled = true;
            const authorized = typeof lb.requestAuth === 'function' ? await lb.requestAuth() : false;
            authBtn.disabled = false;

            if (authorized) {
                renderAuthRow();
                // После входа догоняем борд отложенным результатом игрока.
                if (window.Adventure && typeof window.Adventure.publishProgress === 'function') {
                    window.Adventure.publishProgress();
                }
                void loadActiveBoard();
            }
        });
        authRowEl.appendChild(authBtn);
    }

    async function loadActiveBoard() {
        const text = messages();
        const lb = core();
        // Токен отсекает гонку: пока летел запрос, пользователь мог переключить вкладку
        // или закрыть модалку — отменённый ответ не имеет права перерисовать список.
        const token = ++fetchToken;

        if (!lb || typeof lb.isAvailable !== 'function' || !lb.isAvailable()) {
            renderStatus(text.unavailable);
            return;
        }

        renderStatus(text.loading);

        let result = null;
        try {
            result = await lb.fetch(activeBoardKey);
        } catch (error) {
            console.warn('[leaderboards] fetch failed', error);
        }

        if (token !== fetchToken) return;

        if (!result) {
            renderStatus(text.unavailable, text.retry, loadActiveBoard);
            return;
        }

        renderEntries(result.entries);
    }

    function openUi(key) {
        buildUi();
        activeBoardKey = boards()[key] ? key : 'endless';
        titleEl.textContent = messages().title;
        renderTabs();
        renderAuthRow();
        overlayEl.classList.add('show');
        overlayEl.setAttribute('aria-hidden', 'false');

        if (window.GameCore && typeof window.GameCore.setInputLocked === 'function') {
            window.GameCore.setInputLocked(true);
        }

        void loadActiveBoard();
    }

    function closeUi() {
        if (!overlayEl) return;
        fetchToken++;
        overlayEl.classList.remove('show');
        overlayEl.setAttribute('aria-hidden', 'true');

        // Ввод разблокирует тот, кто открывал: если поверх лидерборда живёт
        // экран приключения, он вернёт свою блокировку сам.
        if (window.GameCore && typeof window.GameCore.setInputLocked === 'function') {
            const adventureBusy = window.Adventure && typeof window.Adventure.isUiOpen === 'function'
                ? window.Adventure.isUiOpen()
                : false;
            window.GameCore.setInputLocked(!!adventureBusy);
        }
    }

    function isOpen() {
        return !!(overlayEl && overlayEl.classList.contains('show'));
    }

    function applyLanguage(lang) {
        language = normalizeLanguage(lang);
        if (!overlayEl) return;
        titleEl.textContent = messages().title;
        renderTabs();
        renderAuthRow();
        if (isOpen()) void loadActiveBoard();
    }

    language = normalizeLanguage(
        (window.GameCore && typeof window.GameCore.getLanguage === 'function')
            ? window.GameCore.getLanguage()
            : (typeof navigator !== 'undefined' ? navigator.language : 'en')
    );

    window.GameLeaderboardsRegistry.registerUi({
        open: openUi,
        close: closeUi,
        isOpen: isOpen,
        applyLanguage: applyLanguage
    });
})();
;
/**
 * leaderboards/jam.js — адаптер лидербордов портала MY.GAMES JAM.
 *
 * На момент написания в контракте game-bridge (jam.my.games) методов лидерборда ещё
 * нет — они обещаны в ближайшем обновлении. Поэтому адаптер определяется по НАБОРУ
 * кандидатов имён методов: как только jam-sdk отдаст любой из них, лидерборды поедут
 * через портал без правок игрового кода. Когда финальные имена станут известны,
 * достаточно поправить JAM_SUBMIT_METHODS / JAM_FETCH_METHODS.
 *
 * Авторизацию адаптер не предоставляет: игрока портал опознаёт сам, отдельного входа в
 * его контракте нет — ядро в этом случае отвечает «вход не нужен», и модалка не рисует
 * ряд авторизации.
 *
 * Едет в сборки jam и web.
 */
(function () {
    'use strict';

    // Кандидаты имён методов jam-sdk (см. комментарий в шапке файла).
    const JAM_SUBMIT_METHODS = ['setLeaderboardScore', 'submitLeaderboardScore', 'submitScore', 'setScore'];
    const JAM_FETCH_METHODS = ['getLeaderboardEntries', 'getLeaderboard', 'fetchLeaderboard'];

    function jamHost() {
        const jam = window.Jam || window.jam;
        if (!jam) return null;
        // jam.available отвечает «есть ли плеер-родитель» — он гейтит события и
        // рекламу, которым без родителя некуда идти. Лидерборды портала ходят в его
        // API напрямую (game-bridge-contract.md §3), поэтому работают и в сборке,
        // открытой вне симулятора — по QR-коду на телефоне. Там available === false,
        // и гейтить борды на нём значит терять их в самом нужном случае.
        const boards = typeof jam.leaderboardsAvailable === 'function' && jam.leaderboardsAvailable();
        if (jam.available === false && !boards) return null;
        return jam;
    }

    function pickMethod(host, candidates) {
        if (!host) return null;
        for (let i = 0; i < candidates.length; i++) {
            if (typeof host[candidates[i]] === 'function') return candidates[i];
        }
        return null;
    }

    // Разрешается заново на каждом вызове: методы могут доехать позже самого хоста.
    function jamAdapter() {
        const host = jamHost();
        if (!host) return null;
        const submitMethod = pickMethod(host, JAM_SUBMIT_METHODS);
        const fetchMethod = pickMethod(host, JAM_FETCH_METHODS);
        if (!submitMethod && !fetchMethod) return null;
        return { host: host, submitMethod: submitMethod, fetchMethod: fetchMethod };
    }

    // Приводит произвольный ответ портала к нашей форме: пробуем распространённые поля,
    // чтобы не переписывать модуль под финальную схему портала.
    function normalizeGenericEntry(entry, index) {
        if (!entry || typeof entry !== 'object') return null;

        const score = Number(entry.score !== undefined ? entry.score : entry.value);

        return {
            rank: Number(entry.rank || entry.place || index + 1),
            score: Number.isFinite(score) ? score : 0,
            formattedScore: String(entry.formattedScore || entry.score || entry.value || 0),
            name: String(entry.name || entry.publicName || entry.userName || entry.nickname || ''),
            photo: entry.photo || entry.avatar || entry.avatarUrl || null,
            extraData: entry.extraData || null,
            isPlayer: !!(entry.isPlayer || entry.isCurrentUser || entry.isMe)
        };
    }

    window.GameLeaderboardsRegistry.register({
        name: 'jam',
        priority: 10,

        available() {
            return !!jamAdapter();
        },

        async submit(name, score, extra) {
            const adapter = jamAdapter();
            if (!adapter || !adapter.submitMethod) return false;

            // Портал не бросает исключение на отказ — он резолвит false (борд не тот,
            // лимит, сети нет). Отдаём его ответ как есть: ядро само поймёт по false,
            // что запись не прошла, и попробует следующий адаптер.
            return await adapter.host[adapter.submitMethod](name, score, extra);
        },

        async fetch(name, options) {
            const adapter = jamAdapter();
            if (!adapter || !adapter.fetchMethod) return null;

            try {
                const raw = await adapter.host[adapter.fetchMethod](name, options);
                // Форма ответа портала ещё не зафиксирована: принимаем и голый массив,
                // и объект с полем entries.
                const rawEntries = Array.isArray(raw) ? raw : (raw && raw.entries) || [];
                return rawEntries
                    .map(normalizeGenericEntry)
                    .filter(Boolean);
            } catch (error) {
                console.warn('[leaderboards] jam fetch failed', error);
                // null = «не смог»: очередь уходит следующему адаптеру, а не пустому списку.
                return null;
            }
        },
    });
})();
;
/**
 * leaderboards/yandex.js — адаптер лидербордов Yandex Games.
 *
 * Разговаривает не с платформенным SDK напрямую, а с обёрткой window.YandexSDK
 * (yandex-sdk.js): это она поднимает SDK и знает про init. Пока обёртки нет или она не
 * инициализирована, адаптер просто недоступен — ядро спрашивает available() на каждом
 * вызове, поэтому лидерборды сами включатся, как только init долетит.
 *
 * ВАЖНО: имена бордов ('blockChpock', 'blockChpockAdventure') должны быть заведены в
 * консоли разработчика Яндекс.Игр (Лидерборды -> техническое название), иначе setScore
 * вернёт ошибку.
 *
 * Едет только в сборку yandex.
 */
(function () {
    'use strict';

    function host() {
        const sdk = window.YandexSDK;
        if (!sdk || typeof sdk.isAvailable !== 'function' || !sdk.isAvailable()) return null;
        return sdk;
    }

    function normalizeEntry(entry, playerId) {
        const player = entry && entry.player ? entry.player : null;
        let photo = null;

        if (player && typeof player.getAvatarSrc === 'function') {
            try { photo = player.getAvatarSrc('small'); } catch (e) { photo = null; }
        }

        return {
            rank: entry ? entry.rank : 0,
            score: entry ? entry.score : 0,
            formattedScore: entry ? (entry.formattedScore || String(entry.score)) : '0',
            name: (player && player.publicName) ? player.publicName : '',
            photo: photo,
            extraData: entry ? entry.extraData : null,
            isPlayer: !!(player && playerId && player.uniqueID === playerId)
        };
    }

    window.GameLeaderboardsRegistry.register({
        name: 'yandex',
        priority: 40,

        available() {
            return !!host();
        },

        // Яндекс требует авторизации, чтобы записать результат. Чтение доступно всем,
        // поэтому список показываем и анониму — просто без его строки.
        needsAuth() {
            const sdk = host();
            if (!sdk || typeof sdk.isAuthorized !== 'function') return false;
            return !sdk.isAuthorized();
        },

        async requestAuth() {
            const sdk = host();
            if (!sdk || typeof sdk.openAuthDialog !== 'function') return false;
            try {
                return await sdk.openAuthDialog();
            } catch (error) {
                console.warn('[leaderboards] auth failed', error);
                return false;
            }
        },

        async submit(name, score, extra) {
            const sdk = host();
            if (!sdk || typeof sdk.setBoardScore !== 'function') return false;

            // Спрашиваем доступность метода ДО записи: в проекте, где модуль лидербордов
            // не подключён, дальше идти бессмысленно — сразу отдаём «не смог».
            if (typeof sdk.isMethodAvailable === 'function' && !sdk.isMethodAvailable('leaderboards.setScore')) {
                return false;
            }

            return await sdk.setBoardScore(name, score, extra);
        },

        async fetch(name, options) {
            const sdk = host();
            if (!sdk || typeof sdk.getBoardEntries !== 'function') return null;

            const result = await sdk.getBoardEntries(name, options);
            if (!result || !Array.isArray(result.entries)) return null;

            // Свою строку в списке узнаём по uniqueID: у платформы нет флага «это ты».
            const playerId = typeof sdk.getPlayerUniqueID === 'function' ? sdk.getPlayerUniqueID() : null;
            return result.entries.map(entry => normalizeEntry(entry, playerId));
        },
    });
})();
