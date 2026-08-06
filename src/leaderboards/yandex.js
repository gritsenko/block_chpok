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
