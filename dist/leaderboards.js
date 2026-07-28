/**
 * leaderboards.js — единый фасад лидербордов + их UI.
 *
 * Публичный контракт: window.GameLeaderboards
 *   GameLeaderboards.boards                     // { endless: 'имя', adventure: 'имя' }
 *   GameLeaderboards.provider()                 // 'jam' | 'yandex' | 'none'
 *   GameLeaderboards.isAvailable()
 *   GameLeaderboards.submit(key, score, extra)   // Promise<boolean>, тихо игнорит отсутствие хоста
 *   GameLeaderboards.fetch(key, options)         // Promise<{ entries, playerEntry } | null>
 *   GameLeaderboards.openUi(key) / closeUi() / isOpen()
 *   GameLeaderboards.applyLanguage(lang)
 *
 * Два борда: 'endless' — рекорд классики, 'adventure' — суммарные звёзды приключения.
 * ВАЖНО: имена бордов должны быть заведены в консоли разработчика Яндекс.Игр
 * (Лидерборды -> техническое название), иначе setScore вернёт ошибку.
 *
 * Про jam-sdk: на момент написания в контракте game-bridge (jam.my.games) методов
 * лидерборда ещё нет — они обещаны в ближайшем обновлении. Поэтому Jam-адаптер
 * определяется по НАБОРУ кандидатов имён методов: как только jam-sdk отдаст любой
 * из них, лидерборды поедут через портал без правок игрового кода. Когда финальные
 * имена станут известны, достаточно поправить JAM_SUBMIT_METHODS / JAM_FETCH_METHODS.
 *
 * UI (модалка со списком) собирается в JS и живёт целиком внутри этого файла —
 * index.html про него ничего не знает, стили лежат в styles.css.
 */
(function () {
    'use strict';

    const BOARDS = {
        endless: 'blockChpock',
        adventure: 'blockChpockAdventure'
    };

    // Кандидаты имён методов jam-sdk (см. комментарий в шапке файла).
    const JAM_SUBMIT_METHODS = ['setLeaderboardScore', 'submitLeaderboardScore', 'submitScore', 'setScore'];
    const JAM_FETCH_METHODS = ['getLeaderboardEntries', 'getLeaderboard', 'fetchLeaderboard'];

    const DEFAULT_FETCH_OPTIONS = {
        quantityTop: 10,
        includeUser: true,
        quantityAround: 3
    };

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

    // ------------------------------------------------------------------
    // Провайдеры
    // ------------------------------------------------------------------
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

    function jamAdapter() {
        const host = jamHost();
        if (!host) return null;
        const submitMethod = pickMethod(host, JAM_SUBMIT_METHODS);
        const fetchMethod = pickMethod(host, JAM_FETCH_METHODS);
        if (!submitMethod && !fetchMethod) return null;
        return { host: host, submitMethod: submitMethod, fetchMethod: fetchMethod };
    }

    function yandexHost() {
        const sdk = window.YandexSDK;
        if (!sdk || typeof sdk.isAvailable !== 'function' || !sdk.isAvailable()) return null;
        return sdk;
    }

    function provider() {
        if (jamAdapter()) return 'jam';
        if (yandexHost()) return 'yandex';
        return 'none';
    }

    function isAvailable() {
        return provider() !== 'none';
    }

    function boardName(key) {
        return BOARDS[key] || BOARDS.endless;
    }

    // Яндекс требует авторизации, чтобы записать результат. Чтение доступно всем.
    function needsAuth() {
        const sdk = yandexHost();
        if (!sdk || typeof sdk.isAuthorized !== 'function') return false;
        return !sdk.isAuthorized();
    }

    async function requestAuth() {
        const sdk = yandexHost();
        if (!sdk || typeof sdk.openAuthDialog !== 'function') return false;
        try {
            return await sdk.openAuthDialog();
        } catch (error) {
            console.warn('[leaderboards] auth failed', error);
            return false;
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

            const jam = jamAdapter();
            if (jam && jam.submitMethod) {
                try {
                    // Портал не бросает исключение на отказ — он резолвит false
                    // (борд не тот, лимит, сети нет), поэтому проверяем результат.
                    const ok = await jam.host[jam.submitMethod](name, numericScore, extra);
                    if (ok !== false) return true;
                } catch (error) {
                    console.warn('[leaderboards] jam submit failed', error);
                }
            }

            const sdk = yandexHost();
            if (sdk && typeof sdk.setBoardScore === 'function') {
                if (typeof sdk.isMethodAvailable === 'function' && !sdk.isMethodAvailable('leaderboards.setScore')) {
                    return false;
                }
                return await sdk.setBoardScore(name, numericScore, extra);
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
    function normalizeYandexEntry(entry, playerId) {
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

    // Приводит произвольный ответ Jam к нашей форме: пробуем распространённые поля,
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

    async function fetch(key, options) {
        const name = boardName(key);
        const opts = Object.assign({}, DEFAULT_FETCH_OPTIONS, options || {});

        const jam = jamAdapter();
        if (jam && jam.fetchMethod) {
            try {
                const raw = await jam.host[jam.fetchMethod](name, opts);
                const rawEntries = Array.isArray(raw) ? raw : (raw && raw.entries) || [];
                const entries = rawEntries
                    .map(normalizeGenericEntry)
                    .filter(Boolean);
                return { entries: entries, playerEntry: entries.find(e => e.isPlayer) || null };
            } catch (error) {
                console.warn('[leaderboards] jam fetch failed', error);
            }
        }

        const sdk = yandexHost();
        if (sdk && typeof sdk.getBoardEntries === 'function') {
            const result = await sdk.getBoardEntries(name, opts);
            if (!result || !Array.isArray(result.entries)) return null;

            const playerId = typeof sdk.getPlayerUniqueID === 'function' ? sdk.getPlayerUniqueID() : null;
            const entries = result.entries.map(entry => normalizeYandexEntry(entry, playerId));
            return { entries: entries, playerEntry: entries.find(e => e.isPlayer) || null };
        }

        return null;
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

        Object.keys(BOARDS).forEach(key => {
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

    function renderAuthRow() {
        const text = messages();

        if (!authRowEl) return;

        if (!needsAuth()) {
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
            const authorized = await requestAuth();
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
        const token = ++fetchToken;

        if (!isAvailable()) {
            renderStatus(text.unavailable);
            return;
        }

        renderStatus(text.loading);

        let result = null;
        try {
            result = await fetch(activeBoardKey);
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
        activeBoardKey = BOARDS[key] ? key : 'endless';
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
})();
