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
