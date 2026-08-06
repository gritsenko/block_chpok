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
