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
