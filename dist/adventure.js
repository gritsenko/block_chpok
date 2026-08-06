/**
 * adventure.js — режим «Приключение»: уровни, цели, жизни, бустеры, карта и итоги.
 *
 * Разделение ответственности:
 *   levels.js  — ТОЛЬКО данные уровней (layout + goals). Правится дизайнером.
 *   game.js    — ядро: доска, драг, линии, препятствия. Ничего не знает про цели.
 *   adventure.js (этот файл) — вся мета: разбор layout, прогресс целей, звёзды,
 *                жизни, бустеры, реклама между уровнями, весь UI режима.
 *
 * Контракт с ядром:
 *   вниз  — window.GameCore.*  (startGame, setInputLocked, setHammerArmed, ...)
 *   вверх — window.Adventure.onPlacement / onDeadlock / onHammerUsed / onScoreChanged
 *
 * Как добавить уровень: дописать объект в window.ADVENTURE_LEVELS (см. docs/ADVENTURE_MODE.md).
 * Этот файл менять не нужно — новые уровни подхватываются автоматически.
 */
(function () {
    'use strict';

    const LEVELS = Array.isArray(window.ADVENTURE_LEVELS) ? window.ADVENTURE_LEVELS : [];
    const CHAPTERS = Array.isArray(window.ADVENTURE_CHAPTERS) ? window.ADVENTURE_CHAPTERS : [];

    if (LEVELS.length === 0) {
        console.warn('[adventure] levels.js не загружен или пуст — режим приключения выключен.');
        return;
    }

    const STORAGE_KEY = 'block-chpok-adventure-v1';
    const BOARD_SIZE = 8;

    // Жизни: мягкий гейт. Тратится ОДНА жизнь в момент проигрыша уровня и
    // возвращается, если игрок продолжил за rewarded — «я не проиграл, я доплатил».
    const MAX_HEARTS = 5;
    const HEART_REGEN_MS = 12 * 60 * 1000;
    const HEARTS_PER_AD = 2;

    // Реклама: продолжение уровня — главный rewarded-плейсмент режима.
    const CONTINUE_MOVES = 5;
    const BOMB_EXTRA_TURNS = 3;

    // Звёзды считаются от неизрасходованных ходов — работает для ЛЮБОЙ цели,
    // поэтому новые уровни не требуют ручной настройки порогов.
    const STARS_TWO_RATIO = 0.2;
    const STARS_THREE_RATIO = 0.4;

    const CHAR_COLOR_NAMES = { r: 'red', g: 'green', b: 'blue', y: 'yellow', p: 'purple', o: 'orange' };
    const COLOR_NAMES = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];

    // countable — из чего берётся цель, если в уровне указано 'all'.
    const GOAL_TYPES = {
        score: { icon: 'score' },
        lines: { icon: 'lines' },
        blocks: { icon: 'blocks' },
        crates: { icon: 'crate', countable: 'crate' },
        ice: { icon: 'ice', countable: 'ice' },
        gems: { icon: 'gem', countable: 'gem' },
        bombs: { icon: 'bomb', countable: 'bomb' },
        combo: { icon: 'combo' },
        placements: { icon: 'moves' },
        colorClear: { icon: 'color' }
    };

    const I18N = {
        en: {
            adventure: 'Adventure',
            level: 'Level',
            levelShort: 'Lv.',
            moves: 'moves',
            movesLeft: 'Moves',
            play: 'Play',
            goalsTitle: 'Goals',
            locked: 'Locked',
            back: 'Back',
            map: 'Map',
            retry: 'Retry',
            nextLevel: 'Next level',
            levelDone: 'Level complete!',
            levelFailed: 'Level failed',
            failMoves: 'Out of moves!',
            failBomb: 'The bomb went off!',
            failDeadlock: 'No moves left!',
            continueMoves: `Watch ad: +${CONTINUE_MOVES} moves`,
            continueShapes: 'Watch ad: new shapes',
            continueBomb: 'Watch ad: reset bomb timer',
            heartsEmptyTitle: 'Out of lives',
            heartsEmptyText: 'Wait for a refill or watch an ad.',
            heartsAd: `Watch ad: +${HEARTS_PER_AD} lives`,
            nextHeartIn: 'Next life in',
            playClassic: 'Play Classic',
            boosterHammer: 'Hammer',
            boosterShuffle: 'Reshuffle',
            boosterHammerHint: 'Tap any cell to smash it',
            boosterEmpty: 'Out of boosters — earn stars to get more',
            getBooster: 'Watch ad: +1 booster',
            rewardBooster: 'Watch ad: +1 hammer',
            totalStars: 'Stars',
            leaderboard: 'Leaderboard',
            chapter: 'Chapter',
            goals: {
                score: 'Score',
                lines: 'Lines',
                blocks: 'Blocks',
                crates: 'Crates',
                ice: 'Ice',
                gems: 'Gems',
                bombs: 'Defuse bombs',
                combo: 'Combo',
                placements: 'Pieces',
                colorClear: 'Blocks'
            },
            colors: {
                red: 'red', green: 'green', blue: 'blue',
                yellow: 'yellow', purple: 'purple', orange: 'orange'
            }
        },
        ru: {
            adventure: 'Приключение',
            level: 'Уровень',
            levelShort: 'Ур.',
            moves: 'ходов',
            movesLeft: 'Ходы',
            play: 'Играть',
            goalsTitle: 'Цели',
            locked: 'Закрыто',
            back: 'Назад',
            map: 'Карта',
            retry: 'Заново',
            nextLevel: 'Дальше',
            levelDone: 'Уровень пройден!',
            levelFailed: 'Уровень не пройден',
            failMoves: 'Ходы закончились!',
            failBomb: 'Бомба рванула!',
            failDeadlock: 'Ходов больше нет!',
            continueMoves: `Реклама: +${CONTINUE_MOVES} ходов`,
            continueShapes: 'Реклама: новые фигуры',
            continueBomb: 'Реклама: сбросить таймер бомбы',
            heartsEmptyTitle: 'Жизни закончились',
            heartsEmptyText: 'Дождись восстановления или посмотри рекламу.',
            heartsAd: `Реклама: +${HEARTS_PER_AD} жизни`,
            nextHeartIn: 'Новая жизнь через',
            playClassic: 'Играть в классику',
            boosterHammer: 'Молоток',
            boosterShuffle: 'Перемешать',
            boosterHammerHint: 'Тапни по любой клетке',
            boosterEmpty: 'Бустеры закончились — собирай звёзды',
            getBooster: 'Реклама: +1 бустер',
            rewardBooster: 'Реклама: +1 молоток',
            totalStars: 'Звёзды',
            leaderboard: 'Лидеры',
            chapter: 'Глава',
            goals: {
                score: 'Счёт',
                lines: 'Линии',
                blocks: 'Блоки',
                crates: 'Ящики',
                ice: 'Лёд',
                gems: 'Кристаллы',
                bombs: 'Обезвредить бомбы',
                combo: 'Комбо',
                placements: 'Фигуры',
                colorClear: 'Блоки'
            },
            colors: {
                red: 'красные', green: 'зелёные', blue: 'синие',
                yellow: 'жёлтые', purple: 'фиолетовые', orange: 'оранжевые'
            }
        }
    };

    let language = 'ru';
    let state = null;
    let run = null;
    let heartsTimerId = 0;

    // Элементы UI создаются лениво при первом открытии.
    let mapEl = null;
    let mapNodesEl = null;
    let mapHeartsEl = null;
    let mapStarsEl = null;
    let mapLeaderboardBtn = null;
    // Фон карты: два слоя, между которыми идёт кроссфейд при прокрутке к новой главе.
    let mapBgLayers = [];
    let mapBgTop = 0;
    let mapBgChapterId = null;
    let mapBgZ = 0;
    // Границы глав в координатах скролла: [{ id, bg, el, top }], пересчитываются после рендера.
    let chapterSections = [];
    let mapScrollRaf = 0;
    let modalEl = null;
    let bannerEl = null;
    let hudEl = null;
    let hudTopEl = null;
    let hudLevelEl = null;
    let hudMovesEl = null;
    let hudGoalsEl = null;
    let boostersEl = null;

    function text() {
        return I18N[language] || I18N.en;
    }

    function core() {
        return window.GameCore || null;
    }

    function pickLocalized(value) {
        if (!value) return '';
        if (typeof value === 'string') return value;
        return value[language] || value.en || value.ru || '';
    }

    // ------------------------------------------------------------------
    // Прогресс игрока
    // ------------------------------------------------------------------
    function defaultState() {
        return {
            v: 1,
            levels: {},                 // id -> { stars, score }
            current: 1,                 // первый непройденный уровень
            hearts: MAX_HEARTS,
            heartsAt: Date.now(),
            boosters: { hammer: 1, shuffle: 1 }
        };
    }

    function loadState() {
        let parsed = null;

        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) parsed = JSON.parse(raw);
        } catch (error) {
            console.warn('[adventure] не удалось прочитать прогресс:', error);
        }

        const fresh = defaultState();
        if (!parsed || typeof parsed !== 'object') return fresh;

        return {
            v: 1,
            levels: (parsed.levels && typeof parsed.levels === 'object') ? parsed.levels : fresh.levels,
            current: Number.isFinite(parsed.current) ? Math.max(1, parsed.current) : fresh.current,
            hearts: Number.isFinite(parsed.hearts) ? Math.max(0, Math.min(MAX_HEARTS, parsed.hearts)) : fresh.hearts,
            heartsAt: Number.isFinite(parsed.heartsAt) ? parsed.heartsAt : fresh.heartsAt,
            boosters: {
                hammer: Math.max(0, Number(parsed.boosters && parsed.boosters.hammer) || 0),
                shuffle: Math.max(0, Number(parsed.boosters && parsed.boosters.shuffle) || 0)
            }
        };
    }

    function saveState() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            // Приватный режим / переполненное хранилище — играть это не мешает.
        }
    }

    function getTotalStars() {
        return Object.keys(state.levels).reduce((sum, id) => sum + (state.levels[id].stars || 0), 0);
    }

    function isLevelUnlocked(id) {
        if (id <= 1) return true;
        return !!state.levels[id - 1];
    }

    function getLevelById(id) {
        for (let i = 0; i < LEVELS.length; i++) {
            if (LEVELS[i].id === id) return LEVELS[i];
        }
        return null;
    }

    function getChapterFor(id) {
        for (let i = 0; i < CHAPTERS.length; i++) {
            const chapter = CHAPTERS[i];
            if (id >= chapter.from && id <= chapter.to) return chapter;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Жизни
    // ------------------------------------------------------------------
    function refreshHearts() {
        const now = Date.now();

        if (state.hearts >= MAX_HEARTS) {
            state.heartsAt = now;
            return;
        }

        const elapsed = now - state.heartsAt;
        if (elapsed < 0) {
            // Часы уехали назад — не наказываем игрока, просто перезапускаем отсчёт.
            state.heartsAt = now;
            saveState();
            return;
        }

        const gained = Math.floor(elapsed / HEART_REGEN_MS);
        if (gained <= 0) return;

        state.hearts = Math.min(MAX_HEARTS, state.hearts + gained);
        state.heartsAt = state.hearts >= MAX_HEARTS ? now : state.heartsAt + gained * HEART_REGEN_MS;
        saveState();
    }

    function heartsEtaMs() {
        refreshHearts();
        if (state.hearts >= MAX_HEARTS) return 0;
        return Math.max(0, state.heartsAt + HEART_REGEN_MS - Date.now());
    }

    function formatEta(ms) {
        const total = Math.ceil(ms / 1000);
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    function spendHeart() {
        refreshHearts();
        if (state.hearts <= 0) return false;

        if (state.hearts >= MAX_HEARTS) {
            // Отсчёт регенерации начинается с первой потерянной жизни.
            state.heartsAt = Date.now();
        }

        state.hearts -= 1;
        saveState();
        return true;
    }

    function addHearts(count) {
        refreshHearts();
        state.hearts = Math.min(MAX_HEARTS, state.hearts + count);
        if (state.hearts >= MAX_HEARTS) state.heartsAt = Date.now();
        saveState();
    }

    // ------------------------------------------------------------------
    // Разбор layout уровня
    // ------------------------------------------------------------------
    function emptyGrid() {
        const grid = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            grid.push(new Array(BOARD_SIZE).fill(null));
        }
        return grid;
    }

    function randomColorToken() {
        const colors = core() ? core().COLORS : null;
        if (!colors) return null;
        const name = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
        return colors[name] || null;
    }

    function colorToken(name) {
        const colors = core() ? core().COLORS : null;
        return (colors && colors[name]) || null;
    }

    // Превращает 8 строк легенды в две сетки (цвета + препятствия) и счётчики целей.
    function parseLayout(layout) {
        const colors = emptyGrid();
        const obstacles = emptyGrid();
        const counts = { crate: 0, ice: 0, gem: 0, bomb: 0, rock: 0 };

        if (!Array.isArray(layout)) {
            return { colors: colors, obstacles: obstacles, counts: counts };
        }

        for (let r = 0; r < BOARD_SIZE; r++) {
            const line = typeof layout[r] === 'string' ? layout[r] : '';

            for (let c = 0; c < BOARD_SIZE; c++) {
                const ch = line[c] || '.';

                if (ch === '.' || ch === ' ') continue;

                if (ch === '#') {
                    obstacles[r][c] = { type: 'void' };
                    continue;
                }

                if (ch === '*') {
                    colors[r][c] = randomColorToken();
                    continue;
                }

                if (CHAR_COLOR_NAMES[ch]) {
                    colors[r][c] = colorToken(CHAR_COLOR_NAMES[ch]);
                    continue;
                }

                if (ch === 'd') {
                    colors[r][c] = randomColorToken();
                    obstacles[r][c] = { type: 'gem' };
                    counts.gem += 1;
                    continue;
                }

                if (ch === 's' || ch === 'S' || ch === 'T') {
                    const hp = ch === 's' ? 1 : (ch === 'S' ? 2 : 3);
                    obstacles[r][c] = { type: 'rock', hp: hp };
                    counts.rock += 1;
                    continue;
                }

                if (ch === 'c' || ch === 'C') {
                    obstacles[r][c] = { type: 'crate', hp: ch === 'c' ? 1 : 2 };
                    counts.crate += 1;
                    continue;
                }

                if (ch === 'i' || ch === 'I') {
                    obstacles[r][c] = { type: 'ice', hp: ch === 'i' ? 1 : 2 };
                    counts.ice += 1;
                    continue;
                }

                if (ch >= '1' && ch <= '9') {
                    obstacles[r][c] = { type: 'bomb', turns: Number(ch) };
                    counts.bomb += 1;
                    continue;
                }

                console.warn(`[adventure] неизвестный символ layout '${ch}' в строке ${r}`);
            }
        }

        return { colors: colors, obstacles: obstacles, counts: counts };
    }

    function countShapeCells(shape) {
        let cells = 0;
        for (let r = 0; r < shape.matrix.length; r++) {
            for (let c = 0; c < shape.matrix[r].length; c++) {
                if (shape.matrix[r][c]) cells += 1;
            }
        }
        return cells;
    }

    // Ограничение набора фигур — необязательный твист уровня.
    function buildShapePool(kind) {
        const all = core() ? core().SHAPES : null;
        if (!all || !kind || kind === 'all') return null;

        const filtered = all.filter(shape => {
            const rows = shape.matrix.length;
            const cols = shape.matrix[0].length;
            const cells = countShapeCells(shape);

            if (kind === 'small') return cells <= 4;
            if (kind === 'big') return cells >= 5;
            if (kind === 'lines') return (rows === 1 || cols === 1) && cells >= 3;
            return true;
        });

        // Меньше трёх фигур — трей нечем наполнять, откатываемся на полный набор.
        if (filtered.length < 3) {
            console.warn(`[adventure] набор фигур '${kind}' слишком узкий — используем полный.`);
            return null;
        }

        return filtered;
    }

    // ------------------------------------------------------------------
    // Цели
    // ------------------------------------------------------------------
    function buildGoals(level, counts) {
        const goals = [];
        const source = (level && level.goals) || {};

        Object.keys(source).forEach(key => {
            const definition = GOAL_TYPES[key];
            if (!definition) {
                console.warn(`[adventure] неизвестная цель '${key}' в уровне ${level.id}`);
                return;
            }

            if (key === 'colorClear') {
                const raw = source[key] || {};
                const token = colorToken(raw.color);
                if (!token) {
                    console.warn(`[adventure] цель colorClear с неизвестным цветом '${raw.color}' (уровень ${level.id})`);
                    return;
                }
                goals.push({
                    type: key,
                    target: Math.max(1, Math.floor(Number(raw.count) || 0)),
                    progress: 0,
                    colorName: raw.color,
                    colorToken: token
                });
                return;
            }

            let target = source[key];
            if (target === 'all') {
                target = definition.countable ? (counts[definition.countable] || 0) : 0;
            }
            target = Math.floor(Number(target) || 0);

            if (target <= 0) {
                console.warn(`[adventure] цель '${key}' уровня ${level.id} схлопнулась в 0 — пропущена`);
                return;
            }

            goals.push({ type: key, target: target, progress: 0 });
        });

        return goals;
    }

    function goalLabel(goal) {
        const dict = text();
        if (goal.type === 'colorClear') {
            const colorName = (dict.colors && dict.colors[goal.colorName]) || goal.colorName;
            return `${dict.goals.colorClear} (${colorName})`;
        }
        return dict.goals[goal.type] || goal.type;
    }

    function goalIcon(goal) {
        return (GOAL_TYPES[goal.type] && GOAL_TYPES[goal.type].icon) || 'score';
    }

    function isGoalDone(goal) {
        return goal.progress >= goal.target;
    }

    function areGoalsDone() {
        return !!run && run.goals.length > 0 && run.goals.every(isGoalDone);
    }

    function applyProgress(event) {
        if (!run) return;

        const collected = event.collected || {};
        const colors = collected.colors || {};

        run.goals.forEach(goal => {
            switch (goal.type) {
                case 'score':
                    goal.progress = event.score || 0;
                    break;
                case 'lines':
                    goal.progress += event.lines || 0;
                    break;
                case 'blocks':
                    goal.progress += collected.blocks || 0;
                    break;
                case 'crates':
                    goal.progress += collected.crates || 0;
                    break;
                case 'ice':
                    goal.progress += collected.ice || 0;
                    break;
                case 'gems':
                    goal.progress += collected.gems || 0;
                    break;
                case 'bombs':
                    goal.progress += collected.bombs || 0;
                    break;
                case 'combo':
                    goal.progress = Math.max(goal.progress, event.combo || 0);
                    break;
                case 'placements':
                    goal.progress += event.placements || 0;
                    break;
                case 'colorClear':
                    goal.progress += colors[goal.colorToken] || 0;
                    break;
                default:
                    break;
            }

            if (goal.progress > goal.target) goal.progress = goal.target;
        });
    }

    // ------------------------------------------------------------------
    // Жизненный цикл уровня
    // ------------------------------------------------------------------
    function computeStars() {
        if (!run) return 1;

        // Продолжение за рекламу — уровень пройден, но на 3 звезды уже не тянет:
        // остаётся мотив вернуться и закрыть его «чисто».
        if (run.usedContinue) return Math.min(2, 1 + (run.movesLeft > 0 ? 1 : 0));

        const ratio = run.movesLimit > 0 ? run.movesLeft / run.movesLimit : 0;
        if (ratio >= STARS_THREE_RATIO) return 3;
        if (ratio >= STARS_TWO_RATIO) return 2;
        return 1;
    }

    function startLevel(levelId) {
        const level = getLevelById(levelId);
        if (!level) return false;

        if (!isLevelUnlocked(levelId)) return false;

        refreshHearts();
        if (state.hearts <= 0) {
            showHeartsEmpty(levelId);
            return false;
        }

        const parsed = parseLayout(level.layout);
        const goals = buildGoals(level, parsed.counts);

        if (goals.length === 0) {
            console.warn(`[adventure] уровень ${levelId} без валидных целей — пропускаем`);
            return false;
        }

        const movesLimit = Math.max(1, Math.floor(Number(level.moves) || 12));

        run = {
            levelId: levelId,
            level: level,
            goals: goals,
            movesLimit: movesLimit,
            movesLeft: movesLimit,
            placements: 0,
            usedContinue: false,
            resolved: null,
            startedAt: Date.now()
        };

        closeModal();
        closeMap();

        const setup = {
            colors: parsed.colors,
            obstacles: parsed.obstacles,
            shapePool: buildShapePool(level.shapes)
        };

        if (core()) {
            core().trackEvent('level_start', { level: levelId, moves: movesLimit });
            core().startGame({ mode: core().MODE_ADVENTURE, level: setup });
        }

        renderHud();
        renderBoosters();
        showGoalBanner();
        return true;
    }

    function restartLevel() {
        if (!run) return;
        const levelId = run.levelId;
        run = null;
        startLevel(levelId);
    }

    function finishRun() {
        run = null;
        if (core()) {
            core().setHammerArmed(false);
        }
    }

    function levelWin() {
        if (!run || run.resolved) return;

        run.resolved = 'win';
        const levelId = run.levelId;
        const stars = computeStars();
        const score = core() ? core().getScore() : 0;

        const previous = state.levels[levelId];
        state.levels[levelId] = {
            stars: Math.max(stars, previous ? previous.stars || 0 : 0),
            score: Math.max(score, previous ? previous.score || 0 : 0)
        };

        if (state.current <= levelId) {
            state.current = Math.min(LEVELS.length, levelId + 1);
        }

        // Три звезды с первого раза — небольшой подарок, чтобы бустеры не были
        // только рекламными и у мастерства был материальный смысл.
        if (!previous && stars === 3) {
            state.boosters.hammer += 1;
        }

        saveState();
        publishProgress();

        if (core()) {
            core().setInputLocked(true);
            core().setHammerArmed(false);
            core().trackEvent('level_complete', {
                level: levelId,
                stars: stars,
                moves_left: run.movesLeft,
                score: score
            });
            core().refreshSplashSubtitles();
        }

        // Два разных канала, и здесь — единственное место, где момент у них совпадает:
        // портальная воронка прогресса и событие, которого требует сам хост.
        if (window.GameAds && typeof window.GameAds.levelComplete === 'function') {
            window.GameAds.levelComplete(levelId, { stars: stars, score: score });
        }

        if (window.GamePlatform) {
            window.GamePlatform.reportEvent('level_complete', { level: levelId });
        }

        showWinModal(levelId, stars, score);
    }

    function levelFail(reason) {
        if (!run || run.resolved) return;

        run.resolved = 'fail';
        run.failReason = reason;

        spendHeart();

        if (core()) {
            core().setInputLocked(true);
            core().setHammerArmed(false);
            core().trackEvent('level_failed', {
                level: run.levelId,
                reason: reason,
                moves_left: run.movesLeft
            });
        }

        showFailModal(reason);
    }

    // Оценка ситуации после каждого хода: сначала победа, потом лимиты.
    function evaluateRun() {
        if (!run || run.resolved) return;

        if (areGoalsDone()) {
            levelWin();
            return;
        }

        if (run.movesLeft <= 0) {
            levelFail('moves');
        }
    }

    function grantContinue() {
        if (!run) return;

        run.usedContinue = true;
        run.resolved = null;
        run.movesLeft += CONTINUE_MOVES;
        run.movesLimit += CONTINUE_MOVES;
        // Продолжение — не проигрыш: возвращаем списанную жизнь.
        addHearts(1);

        closeModal();
        renderHud();

        if (core()) {
            core().setInputLocked(false);
            core().markRewardedWatched();
        }
    }

    function grantReshuffle() {
        if (!run) return;

        run.usedContinue = true;
        run.resolved = null;
        addHearts(1);

        closeModal();

        if (core()) {
            core().setInputLocked(false);
            core().reshuffleTray();
            core().markRewardedWatched();
        }
    }

    function grantBombTime() {
        if (!run) return;

        run.usedContinue = true;
        run.resolved = null;
        addHearts(1);

        closeModal();

        if (core()) {
            core().setInputLocked(false);
            core().addBombTurns(BOMB_EXTRA_TURNS);
            core().markRewardedWatched();
        }
    }

    function goToNextLevel() {
        const nextId = run ? run.levelId + 1 : state.current;
        finishRun();

        if (!getLevelById(nextId)) {
            // Контент закончился — возвращаем на карту, там видно все звёзды.
            openMap();
            return;
        }

        const sessionMs = core() ? core().getSessionDurationMs() : 0;
        const proceed = () => startLevel(nextId);

        if (core()) core().maybeShowInterstitial(sessionMs, proceed);
        else proceed();
    }

    // ------------------------------------------------------------------
    // Реклама
    // ------------------------------------------------------------------
    function hasAds() {
        return !!(window.GameAds && window.GameAds.hasProvider());
    }

    function showRewarded(onReward) {
        if (!hasAds()) return false;

        let rewarded = false;

        window.GameAds.showRewarded({
            onReward: () => {
                rewarded = true;
                onReward();
            },
            onClose: () => {
                if (!rewarded) {
                    // Награды нет — экран итогов остаётся на месте, ничего не меняем.
                    renderHearts();
                }
            }
        });

        return true;
    }

    // ------------------------------------------------------------------
    // Бустеры
    // ------------------------------------------------------------------
    function useHammer() {
        if (!run || run.resolved || !core()) return;

        if (core().isHammerArmed()) {
            core().setHammerArmed(false);
            renderBoosters();
            return;
        }

        if (state.boosters.hammer <= 0) {
            offerBoosterAd('hammer');
            return;
        }

        core().setHammerArmed(true);
        renderBoosters();
        showToast(text().boosterHammerHint);
    }

    function useShuffle() {
        if (!run || run.resolved || !core()) return;
        if (core().isBusy()) return;

        if (state.boosters.shuffle <= 0) {
            offerBoosterAd('shuffle');
            return;
        }

        state.boosters.shuffle -= 1;
        saveState();
        core().reshuffleTray();
        core().trackEvent('booster_used', { booster: 'shuffle', level: run.levelId });
        renderBoosters();
    }

    function offerBoosterAd(booster) {
        // Без рекламного хоста тап по пустому бустеру не должен быть «мёртвым».
        if (!hasAds()) {
            showToast(text().boosterEmpty);
            return;
        }

        showRewarded(() => {
            state.boosters[booster] = (state.boosters[booster] || 0) + 1;
            saveState();
            renderBoosters();
            if (core()) {
                core().markRewardedWatched();
                core().trackEvent('booster_earned', { booster: booster });
            }
        });
    }

    // ------------------------------------------------------------------
    // UI: вспомогательные фабрики
    // ------------------------------------------------------------------
    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined && content !== null) node.textContent = content;
        return node;
    }

    function button(className, label, onClick) {
        const node = el('button', className, label);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    }

    function starsRow(stars, total) {
        const wrap = el('div', 'adv-stars-row');
        for (let i = 0; i < (total || 3); i++) {
            const star = el('span', 'adv-star');
            if (i < stars) star.classList.add('adv-star-filled');
            wrap.appendChild(star);
        }
        return wrap;
    }

    function showToast(message) {
        const toast = el('div', 'adv-toast', message);
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('adv-toast-hide'), 1400);
        setTimeout(() => toast.remove(), 1900);
    }

    // ------------------------------------------------------------------
    // UI: HUD и бустеры (контейнеры лежат в index.html)
    // ------------------------------------------------------------------
    function ensureHudRefs() {
        if (!hudEl) hudEl = document.getElementById('adventure-hud');
        // Уровень и ходы живут в ряду плашки счёта (.header-stats), цели — отдельным
        // рядом ниже, поэтому видимость переключаем у обоих контейнеров.
        if (!hudTopEl) hudTopEl = document.getElementById('adventure-hud-top');
        if (!hudLevelEl) hudLevelEl = document.getElementById('adventure-hud-level');
        if (!hudMovesEl) hudMovesEl = document.getElementById('adventure-moves-value');
        if (!hudGoalsEl) hudGoalsEl = document.getElementById('adventure-goals');
        if (!boostersEl) boostersEl = document.getElementById('adventure-boosters');
    }

    /* Вёрстка считает ширину игровой колонки из свободной высоты (--play-w в
       styles.css), и ряд HUD — одно из слагаемых этого бюджета. Высота ряда
       зависит от числа целей и языка (на узких экранах чипы переносятся на
       вторую строку), поэтому отдаём в CSS измеренное значение, а не константу.
       Обратной связи нет: ширина HUD равна ширине контейнера и от --hud-h не
       зависит, так что пересчёт не может зациклиться. */
    function syncHudBudget() {
        const container = document.querySelector('.game-container');
        if (!container) return;

        const previous = container.style.getPropertyValue('--hud-h');
        let next = '';

        if (hudEl && !hudEl.hidden) {
            const cs = window.getComputedStyle(hudEl);
            const net = hudEl.offsetHeight
                + (parseFloat(cs.marginTop) || 0)
                + (parseFloat(cs.marginBottom) || 0);
            next = Math.max(0, Math.round(net)) + 'px';
        }

        if (next === previous) return;

        if (next) container.style.setProperty('--hud-h', next);
        else container.style.removeProperty('--hud-h');

        // Ширина доски пересчитывается из этого значения, а окно при этом не
        // менялось — сообщаем ядру сами, иначе WebGL-канвас и кэш геометрии
        // останутся с прежними размерами. Событие шлём ТОЛЬКО при реальном
        // изменении: наш же обработчик resize снова вызовет syncHudBudget.
        window.dispatchEvent(new Event('resize'));
    }

    function renderHud() {
        ensureHudRefs();
        if (!hudEl) return;

        const active = !!run && !run.resolved;
        hudEl.hidden = !run;
        if (hudTopEl) hudTopEl.hidden = !run;

        if (!run) {
            document.body.classList.remove('adv-goals-many');
            syncHudBudget();
            return;
        }

        if (hudLevelEl) hudLevelEl.textContent = `${text().levelShort} ${run.levelId}`;
        if (hudMovesEl) {
            hudMovesEl.textContent = String(Math.max(0, run.movesLeft));
            hudMovesEl.classList.toggle('adv-moves-low', active && run.movesLeft <= 3);
        }

        if (!hudGoalsEl) {
            syncHudBudget();
            return;
        }

        // Три-четыре цели в один ряд крупными чипами не влезают, поэтому на таких
        // уровнях чипы ужимаются (правила — в styles.css).
        document.body.classList.toggle('adv-goals-many', run.goals.length >= 3);

        hudGoalsEl.innerHTML = '';
        run.goals.forEach(goal => {
            const chip = el('div', `adv-chip adv-chip-${goalIcon(goal)}`);
            if (isGoalDone(goal)) chip.classList.add('adv-chip-done');

            chip.appendChild(el('span', 'adv-chip-icon'));
            chip.appendChild(el('span', 'adv-chip-text', formatGoalCounter(goal)));
            chip.title = goalLabel(goal);
            hudGoalsEl.appendChild(chip);
        });

        syncHudBudget();
    }

    function formatGoalCounter(goal) {
        const format = core() ? core().formatNumber : String;
        if (isGoalDone(goal)) return format(goal.target);
        return `${format(goal.progress)}/${format(goal.target)}`;
    }

    function renderBoosters() {
        ensureHudRefs();
        if (!boostersEl) return;

        const visible = !!run && !run.resolved;
        boostersEl.hidden = !visible;
        if (!visible) return;

        boostersEl.innerHTML = '';

        const hammerBtn = button('adv-booster adv-booster-hammer', '', useHammer);
        hammerBtn.appendChild(el('span', 'adv-booster-icon'));
        hammerBtn.appendChild(el('span', 'adv-booster-count', badgeFor(state.boosters.hammer)));
        hammerBtn.setAttribute('aria-label', text().boosterHammer);
        if (core() && core().isHammerArmed()) hammerBtn.classList.add('adv-booster-armed');
        boostersEl.appendChild(hammerBtn);

        const shuffleBtn = button('adv-booster adv-booster-shuffle', '', useShuffle);
        shuffleBtn.appendChild(el('span', 'adv-booster-icon'));
        shuffleBtn.appendChild(el('span', 'adv-booster-count', badgeFor(state.boosters.shuffle)));
        shuffleBtn.setAttribute('aria-label', text().boosterShuffle);
        boostersEl.appendChild(shuffleBtn);
    }

    // Пустой бустер показывает «+»: тап предлагает получить его за рекламу.
    function badgeFor(count) {
        return count > 0 ? String(count) : '+';
    }

    function showGoalBanner() {
        if (!run) return;

        if (!bannerEl) {
            bannerEl = el('div', 'adv-banner');
            document.body.appendChild(bannerEl);
        }

        bannerEl.innerHTML = '';
        bannerEl.appendChild(el('div', 'adv-banner-level', `${text().level} ${run.levelId}`));
        bannerEl.appendChild(el('div', 'adv-banner-name', pickLocalized(run.level.name)));

        const goalsWrap = el('div', 'adv-banner-goals');
        run.goals.forEach(goal => {
            goalsWrap.appendChild(el('div', 'adv-banner-goal', `${goalLabel(goal)}: ${goal.target}`));
        });
        bannerEl.appendChild(goalsWrap);

        const hint = pickLocalized(run.level.hint);
        if (hint) bannerEl.appendChild(el('div', 'adv-banner-hint', hint));

        bannerEl.classList.remove('adv-banner-hide');
        void bannerEl.offsetWidth;
        bannerEl.classList.add('adv-banner-show');

        setTimeout(() => {
            if (!bannerEl) return;
            bannerEl.classList.remove('adv-banner-show');
            bannerEl.classList.add('adv-banner-hide');
        }, 2200);
    }

    // Трофей на карте ведёт в модалку рейтинга, которой в сборке без лидербордов нет.
    // Ядро дёргает это через window.Adventure.syncLeaderboardButton, когда доступность
    // хоста меняется; аргумент необязателен, чтобы кнопка могла проверить себя сама.
    function syncLeaderboardButton(available) {
        if (!mapLeaderboardBtn) return;

        const canShow = (typeof available === 'boolean')
            ? available
            : !!(window.GameLeaderboards
                && typeof window.GameLeaderboards.isAvailable === 'function'
                && window.GameLeaderboards.isAvailable()
                && typeof window.GameLeaderboards.openUi === 'function');

        mapLeaderboardBtn.hidden = !canShow;
    }

    // ------------------------------------------------------------------
    // UI: карта уровней
    // ------------------------------------------------------------------
    function buildMap() {
        if (mapEl) return;

        mapEl = el('div', 'adv-overlay adv-map');
        mapEl.setAttribute('aria-hidden', 'true');
        mapEl.appendChild(buildMapBackground());

        const top = el('div', 'adv-map-top');
        // Иконка стрелки — фон из CSS (SVG-шеврон), поэтому текстовой метки нет
        // и подпись живёт в aria-label.
        const backBtn = button('adv-icon-btn adv-back-btn', '', () => {
            closeMap();
            if (core()) core().returnToModeSelect();
        });
        backBtn.setAttribute('aria-label', text().back);
        top.appendChild(backBtn);

        const counters = el('div', 'adv-map-counters');
        mapHeartsEl = el('div', 'adv-hearts');
        counters.appendChild(mapHeartsEl);
        mapStarsEl = el('div', 'adv-total-stars');
        counters.appendChild(mapStarsEl);
        top.appendChild(counters);

        // Иконка кнопки — фон из CSS (assets/theme/icons/icon-trophy.png), поэтому
        // текстовой метки нет и подпись живёт в aria-label.
        const leaderboardBtn = button('adv-icon-btn adv-lb-btn', '', () => {
            if (window.GameLeaderboards && typeof window.GameLeaderboards.openUi === 'function') {
                window.GameLeaderboards.openUi('adventure');
            }
        });
        leaderboardBtn.setAttribute('aria-label', text().leaderboard);
        top.appendChild(leaderboardBtn);
        mapLeaderboardBtn = leaderboardBtn;
        syncLeaderboardButton();

        mapEl.appendChild(top);

        mapNodesEl = el('div', 'adv-map-scroll');
        mapNodesEl.addEventListener('scroll', onMapScroll, { passive: true });
        mapEl.appendChild(mapNodesEl);

        window.addEventListener('resize', measureChapterSections);

        document.body.appendChild(mapEl);
    }

    // ------------------------------------------------------------------
    // Фон карты: у каждой главы свой, меняется кроссфейдом при прокрутке
    // ------------------------------------------------------------------
    function buildMapBackground() {
        const wrap = el('div', 'adv-map-bg');

        mapBgLayers = [el('div', 'adv-map-bg-layer'), el('div', 'adv-map-bg-layer')];
        mapBgLayers.forEach(layer => wrap.appendChild(layer));
        mapBgTop = 0;
        mapBgZ = 0;
        mapBgChapterId = null;

        // Скрим поверх картинки — чтобы узлы и плашки глав оставались читаемыми.
        wrap.appendChild(el('div', 'adv-map-bg-scrim'));

        preloadChapterBackgrounds();

        return wrap;
    }

    // Прогреваем кэш браузера, иначе первый кроссфейд к главе показывает пустой слой.
    function preloadChapterBackgrounds() {
        CHAPTERS.forEach(chapter => {
            if (!chapter || !chapter.bg) return;
            const img = new Image();
            img.src = chapter.bg;
        });
    }

    function setMapBackground(chapter, animate) {
        if (mapBgLayers.length < 2) return;

        const id = chapter ? chapter.id : null;
        if (id === mapBgChapterId) return;
        mapBgChapterId = id;

        const url = chapter && chapter.bg ? `url('${chapter.bg}')` : 'none';

        if (!animate) {
            const layer = mapBgLayers[mapBgTop];
            layer.style.backgroundImage = url;
            layer.classList.add('is-visible');
            mapBgLayers[mapBgTop ^ 1].classList.remove('is-visible');
            return;
        }

        // Симметричный кроссфейд: входящий слой всплывает поверх уходящего. Если глава
        // сменится посреди перехода, слои просто меняются ролями и opacity доезжает
        // с текущего значения — без рывка.
        const next = mapBgLayers[mapBgTop ^ 1];
        next.style.backgroundImage = url;
        next.style.zIndex = String(++mapBgZ);
        void next.offsetWidth;
        next.classList.add('is-visible');
        mapBgLayers[mapBgTop].classList.remove('is-visible');
        mapBgTop ^= 1;
    }

    // Верх каждой главы в координатах скролла. getBoundingClientRect, а не offsetTop:
    // offsetParent у .adv-map-scroll — сама карта, и в offsetTop попадала бы шапка.
    function measureChapterSections() {
        if (!mapNodesEl || !chapterSections.length) return;

        const scrollTop = mapNodesEl.scrollTop;
        const originY = mapNodesEl.getBoundingClientRect().top;

        chapterSections.forEach(section => {
            section.top = section.el.getBoundingClientRect().top - originY + scrollTop;
        });
    }

    function chapterInView() {
        if (!mapNodesEl || !chapterSections.length) return null;

        // Опорная линия — верхняя треть окна: глава «наступает», когда её плашка
        // поднимается к ней, а не когда только-только показалась снизу.
        const line = mapNodesEl.scrollTop + mapNodesEl.clientHeight * 0.35;
        let found = chapterSections[0];

        for (let i = 1; i < chapterSections.length; i++) {
            if (chapterSections[i].top > line) break;
            found = chapterSections[i];
        }

        return found.chapter;
    }

    function syncMapBackground(animate) {
        setMapBackground(chapterInView(), animate);
    }

    function onMapScroll() {
        if (mapScrollRaf) return;
        mapScrollRaf = requestAnimationFrame(() => {
            mapScrollRaf = 0;
            syncMapBackground(true);
        });
    }

    function renderHearts() {
        if (!mapHeartsEl) return;

        refreshHearts();
        mapHeartsEl.innerHTML = '';
        mapHeartsEl.appendChild(el('span', 'adv-heart-icon'));
        mapHeartsEl.appendChild(el('span', 'adv-heart-count', `${state.hearts}/${MAX_HEARTS}`));

        if (state.hearts < MAX_HEARTS) {
            mapHeartsEl.appendChild(el('span', 'adv-heart-timer', formatEta(heartsEtaMs())));
        }
    }

    function renderMapNodes() {
        if (!mapNodesEl) return;

        mapNodesEl.innerHTML = '';

        if (mapStarsEl) {
            mapStarsEl.innerHTML = '';
            mapStarsEl.appendChild(el('span', 'adv-star-badge'));
            mapStarsEl.appendChild(el('span', 'adv-total-stars-value', String(getTotalStars())));
        }

        let lastChapterId = null;
        chapterSections = [];

        LEVELS.forEach(level => {
            const chapter = getChapterFor(level.id);
            const chapterId = chapter ? chapter.id : null;

            if (chapterId !== lastChapterId) {
                lastChapterId = chapterId;
                const header = el('div', 'adv-chapter');
                header.appendChild(el('span', 'adv-chapter-index', chapter ? `${text().chapter} ${chapter.id}` : ''));
                header.appendChild(el('span', 'adv-chapter-name', chapter ? pickLocalized(chapter.name) : ''));
                mapNodesEl.appendChild(header);
                chapterSections.push({ chapter: chapter, el: header, top: 0 });
            }

            const record = state.levels[level.id];
            const unlocked = isLevelUnlocked(level.id);
            const isCurrent = level.id === state.current;

            const node = button('adv-node', '', () => {
                if (!unlocked) return;
                showIntroModal(level.id);
            });

            if (!unlocked) node.classList.add('adv-node-locked');
            if (record) node.classList.add('adv-node-done');
            if (isCurrent && unlocked) node.classList.add('adv-node-current');
            node.disabled = !unlocked;

            node.appendChild(el('span', 'adv-node-index', String(level.id)));
            node.appendChild(starsRow(record ? record.stars : 0));
            mapNodesEl.appendChild(node);
        });

        // Прокручиваем к текущему уровню, чтобы игрок сразу видел, куда идти.
        requestAnimationFrame(() => {
            const currentNode = mapNodesEl.querySelector('.adv-node-current');
            if (currentNode && typeof currentNode.scrollIntoView === 'function') {
                currentNode.scrollIntoView({ block: 'center' });
            }

            // Фон под уровень, на котором остановились: при первом открытии — сразу,
            // без фейда из пустоты.
            measureChapterSections();
            syncMapBackground(mapBgChapterId !== null);
        });
    }

    function startHeartsTimer() {
        stopHeartsTimer();
        heartsTimerId = window.setInterval(() => {
            const before = state.hearts;
            renderHearts();
            if (state.hearts !== before) renderMapNodes();
        }, 1000);
    }

    function stopHeartsTimer() {
        if (heartsTimerId) {
            window.clearInterval(heartsTimerId);
            heartsTimerId = 0;
        }
    }

    function openMap() {
        buildMap();
        closeModal();
        finishRun();
        renderHud();
        renderBoosters();
        renderHearts();
        renderMapNodes();
        startHeartsTimer();

        mapEl.classList.add('show');
        mapEl.setAttribute('aria-hidden', 'false');

        if (core()) core().setInputLocked(true);
    }

    function closeMap() {
        stopHeartsTimer();
        if (mapScrollRaf) {
            cancelAnimationFrame(mapScrollRaf);
            mapScrollRaf = 0;
        }
        if (!mapEl) return;
        mapEl.classList.remove('show');
        mapEl.setAttribute('aria-hidden', 'true');
    }

    function isMapOpen() {
        return !!(mapEl && mapEl.classList.contains('show'));
    }

    // ------------------------------------------------------------------
    // UI: модалки (интро / победа / провал / нет жизней)
    // ------------------------------------------------------------------
    function ensureModal() {
        if (modalEl) return;

        modalEl = el('div', 'adv-overlay adv-modal-overlay');
        modalEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(modalEl);
    }

    function openModal(panel) {
        ensureModal();
        modalEl.innerHTML = '';
        modalEl.appendChild(panel);
        modalEl.classList.add('show');
        modalEl.setAttribute('aria-hidden', 'false');
        if (core()) core().setInputLocked(true);
    }

    function closeModal() {
        if (!modalEl) return;
        modalEl.classList.remove('show');
        modalEl.setAttribute('aria-hidden', 'true');
        modalEl.innerHTML = '';
    }

    function isModalOpen() {
        return !!(modalEl && modalEl.classList.contains('show'));
    }

    function goalListElement(goals) {
        const list = el('div', 'adv-goal-list');

        goals.forEach(goal => {
            const row = el('div', 'adv-goal-row');
            row.appendChild(el('span', `adv-chip-icon adv-chip-${goalIcon(goal)}`));
            row.appendChild(el('span', 'adv-goal-label', goalLabel(goal)));
            row.appendChild(el('span', 'adv-goal-target', String(goal.target)));
            list.appendChild(row);
        });

        return list;
    }

    function showIntroModal(levelId) {
        const level = getLevelById(levelId);
        if (!level) return;

        refreshHearts();
        if (state.hearts <= 0) {
            showHeartsEmpty(levelId);
            return;
        }

        const parsed = parseLayout(level.layout);
        const goals = buildGoals(level, parsed.counts);
        const record = state.levels[levelId];

        const panel = el('div', 'adv-panel');
        panel.appendChild(el('div', 'adv-panel-eyebrow', `${text().level} ${levelId}`));
        panel.appendChild(el('h2', 'adv-panel-title', pickLocalized(level.name)));
        if (record) panel.appendChild(starsRow(record.stars));

        panel.appendChild(el('div', 'adv-panel-section-title', text().goalsTitle));
        panel.appendChild(goalListElement(goals));

        panel.appendChild(el('div', 'adv-panel-moves', `${level.moves} ${text().moves}`));

        const hint = pickLocalized(level.hint);
        if (hint) panel.appendChild(el('div', 'adv-panel-hint', hint));

        const actions = el('div', 'adv-panel-actions');
        actions.appendChild(button('btn btn-yellow adv-cta', text().play, () => startLevel(levelId)));
        actions.appendChild(button('btn btn-outline adv-cta', text().back, () => {
            closeModal();
            if (!isMapOpen()) openMap();
        }));
        panel.appendChild(actions);

        openModal(panel);
    }

    function showWinModal(levelId, stars, score) {
        const panel = el('div', 'adv-panel adv-panel-win');
        panel.appendChild(el('div', 'adv-panel-eyebrow', `${text().level} ${levelId}`));
        panel.appendChild(el('h2', 'adv-panel-title', text().levelDone));

        const stars3 = starsRow(stars);
        stars3.classList.add('adv-stars-big');
        panel.appendChild(stars3);

        const format = core() ? core().formatNumber : String;
        panel.appendChild(el('div', 'adv-panel-score', format(score)));

        const actions = el('div', 'adv-panel-actions');
        actions.appendChild(button('btn btn-yellow adv-cta', text().nextLevel, goToNextLevel));

        if (hasAds()) {
            actions.appendChild(button('btn btn-outline adv-cta', text().rewardBooster, () => {
                showRewarded(() => {
                    state.boosters.hammer += 1;
                    saveState();
                    showToast(`${text().boosterHammer} +1`);
                    if (core()) {
                        core().markRewardedWatched();
                        core().trackEvent('booster_earned', { booster: 'hammer', level: levelId });
                    }
                });
            }));
        }

        actions.appendChild(button('btn btn-outline adv-cta', text().map, openMap));
        panel.appendChild(actions);

        openModal(panel);
    }

    function showFailModal(reason) {
        const dict = text();
        const reasonText = reason === 'bomb' ? dict.failBomb
            : reason === 'deadlock' ? dict.failDeadlock
                : dict.failMoves;

        const panel = el('div', 'adv-panel adv-panel-fail');
        panel.appendChild(el('div', 'adv-panel-eyebrow', `${dict.level} ${run ? run.levelId : ''}`));
        panel.appendChild(el('h2', 'adv-panel-title', dict.levelFailed));
        panel.appendChild(el('div', 'adv-panel-reason', reasonText));
        panel.appendChild(goalListElement(run ? run.goals : []));

        const actions = el('div', 'adv-panel-actions');

        // Главный rewarded-плейсмент режима: продолжить провальную попытку.
        // Предлагаем только один раз за попытку, иначе уровень перестаёт быть уровнем.
        if (hasAds() && run && !run.usedContinue) {
            if (reason === 'deadlock') {
                actions.appendChild(button('btn btn-yellow adv-cta', dict.continueShapes, () => {
                    showRewarded(grantReshuffle);
                }));
            } else if (reason === 'bomb') {
                actions.appendChild(button('btn btn-yellow adv-cta', dict.continueBomb, () => {
                    showRewarded(grantBombTime);
                }));
            } else {
                actions.appendChild(button('btn btn-yellow adv-cta', dict.continueMoves, () => {
                    showRewarded(grantContinue);
                }));
            }
        }

        actions.appendChild(button('btn btn-outline adv-cta', dict.retry, () => {
            refreshHearts();
            if (state.hearts <= 0) {
                showHeartsEmpty(run ? run.levelId : state.current);
                return;
            }
            restartLevel();
        }));

        actions.appendChild(button('btn btn-outline adv-cta', dict.map, openMap));
        panel.appendChild(actions);

        openModal(panel);
    }

    function showHeartsEmpty(levelId) {
        const dict = text();
        const panel = el('div', 'adv-panel adv-panel-hearts');
        panel.appendChild(el('h2', 'adv-panel-title', dict.heartsEmptyTitle));
        panel.appendChild(el('div', 'adv-panel-reason', dict.heartsEmptyText));
        panel.appendChild(el('div', 'adv-panel-timer', `${dict.nextHeartIn} ${formatEta(heartsEtaMs())}`));

        const actions = el('div', 'adv-panel-actions');

        if (hasAds()) {
            actions.appendChild(button('btn btn-yellow adv-cta', dict.heartsAd, () => {
                showRewarded(() => {
                    addHearts(HEARTS_PER_AD);
                    renderHearts();
                    renderMapNodes();
                    closeModal();
                    if (core()) {
                        core().markRewardedWatched();
                        core().trackEvent('hearts_refilled', { level: levelId || 0 });
                    }
                    if (levelId) startLevel(levelId);
                });
            }));
        }

        // Жизни кончились — не выгоняем игрока из игры, а отправляем в классику.
        actions.appendChild(button('btn btn-outline adv-cta', dict.playClassic, () => {
            closeModal();
            closeMap();
            finishRun();
            // Без перерисовки уровень/ходы и цели остались бы висеть в шапке классики.
            renderHud();
            renderBoosters();
            if (core()) core().startGame({ mode: core().MODE_ENDLESS });
        }));

        actions.appendChild(button('btn btn-outline adv-cta', dict.map, () => {
            closeModal();
            if (!isMapOpen()) openMap();
        }));

        panel.appendChild(actions);
        openModal(panel);
    }

    // ------------------------------------------------------------------
    // Лидерборд приключения
    // ------------------------------------------------------------------
    function publishProgress() {
        if (!window.GameLeaderboards) return;
        window.GameLeaderboards.submit('adventure', getTotalStars(), { level: state.current });
    }

    // ------------------------------------------------------------------
    // Хуки ядра
    // ------------------------------------------------------------------
    function onPlacement(event) {
        if (!run || run.resolved) return;

        run.placements += 1;
        run.movesLeft = Math.max(0, run.movesLeft - 1);

        applyProgress({
            score: event.score,
            lines: event.lines,
            combo: event.combo,
            collected: event.collected,
            placements: 1
        });

        renderHud();

        // Бомба важнее лимита ходов: взрыв — это мгновенный проигрыш.
        if (Array.isArray(event.explodedBombs) && event.explodedBombs.length > 0) {
            levelFail('bomb');
            return;
        }

        evaluateRun();
    }

    function onHammerUsed(event) {
        if (!run || run.resolved) return;

        state.boosters.hammer = Math.max(0, state.boosters.hammer - 1);
        saveState();

        if (core()) {
            core().setHammerArmed(false);
            core().trackEvent('booster_used', { booster: 'hammer', level: run.levelId });
        }

        applyProgress({
            score: core() ? core().getScore() : 0,
            lines: 0,
            combo: 0,
            collected: event.collected,
            placements: 0
        });

        renderHud();
        renderBoosters();

        // Молоток может закрыть последнюю цель — но ход он не тратит.
        if (areGoalsDone()) {
            levelWin();
        }
    }

    function onDeadlock() {
        if (!run || run.resolved) return;
        levelFail('deadlock');
    }

    function onScoreChanged(score) {
        if (!run || run.resolved) return;

        const scoreGoal = run.goals.find(goal => goal.type === 'score');
        if (!scoreGoal) return;

        scoreGoal.progress = Math.min(score, scoreGoal.target);
        renderHud();
    }

    function closeUi() {
        closeModal();
        closeMap();
        finishRun();
        renderHud();
        renderBoosters();
    }

    function applyLanguage(lang) {
        language = (typeof lang === 'string' && lang.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
        renderHud();
        renderBoosters();
        if (isMapOpen()) {
            renderHearts();
            renderMapNodes();
        }
    }

    function getProgressSummary() {
        refreshHearts();
        return {
            currentLevel: state.current,
            totalStars: getTotalStars(),
            totalLevels: LEVELS.length,
            hearts: state.hearts
        };
    }

    // Диагностика уровней: гоняется только на localhost, чтобы опечатки в levels.js
    // всплывали сразу при разработке, а не на проде у игрока.
    function validateLevels() {
        const seenIds = {};
        const problems = [];

        LEVELS.forEach((level, index) => {
            const label = `#${index} (id=${level && level.id})`;

            if (!level || !Number.isFinite(level.id)) {
                problems.push(`${label}: нет числового id`);
                return;
            }

            if (seenIds[level.id]) problems.push(`${label}: дубликат id`);
            seenIds[level.id] = true;

            if (!Number.isFinite(Number(level.moves)) || Number(level.moves) <= 0) {
                problems.push(`${label}: некорректное moves`);
            }

            if (level.layout !== undefined) {
                if (!Array.isArray(level.layout) || level.layout.length !== BOARD_SIZE) {
                    problems.push(`${label}: layout должен быть массивом из ${BOARD_SIZE} строк`);
                } else {
                    level.layout.forEach((line, r) => {
                        if (typeof line !== 'string' || line.length !== BOARD_SIZE) {
                            problems.push(`${label}: строка ${r} должна быть длиной ${BOARD_SIZE}`);
                        }
                    });
                }
            }

            const parsed = parseLayout(level.layout);
            const goals = buildGoals(level, parsed.counts);
            if (goals.length === 0) problems.push(`${label}: нет валидных целей`);

            // Полностью собранная линия на старте = бесплатный сброс на первом ходу.
            for (let r = 0; r < BOARD_SIZE; r++) {
                let full = true;
                let hasColor = false;
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const obstacle = parsed.obstacles[r][c];
                    if (obstacle && obstacle.type === 'void') continue;
                    if (parsed.colors[r][c]) { hasColor = true; continue; }
                    if (obstacle && (obstacle.type === 'rock' || obstacle.type === 'crate' || obstacle.type === 'bomb')) continue;
                    full = false;
                    break;
                }
                if (full && hasColor) problems.push(`${label}: строка ${r} собрана уже на старте`);
            }

            let freeCells = 0;
            let usableCells = 0;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const obstacle = parsed.obstacles[r][c];
                    if (obstacle && obstacle.type === 'void') continue;
                    usableCells += 1;
                    const blocked = obstacle && (obstacle.type === 'rock' || obstacle.type === 'crate' || obstacle.type === 'bomb');
                    if (!parsed.colors[r][c] && !blocked) freeCells += 1;
                }
            }

            if (usableCells > 0 && freeCells / usableCells < 0.45) {
                problems.push(`${label}: свободно только ${Math.round(freeCells / usableCells * 100)}% доски — риск мгновенного тупика`);
            }
        });

        if (problems.length > 0) {
            console.warn(`[adventure] проверка уровней нашла ${problems.length} проблем:\n` + problems.join('\n'));
        } else {
            console.log(`[adventure] ${LEVELS.length} уровней прошли проверку.`);
        }

        return problems;
    }

    state = loadState();
    refreshHearts();
    // Прогресс мог уехать вперёд (например, после обновления контента) — подстрахуемся.
    state.current = Math.max(1, Math.min(LEVELS.length, state.current));

    window.Adventure = {
        openMap: openMap,
        closeUi: closeUi,
        startLevel: startLevel,
        getProgressSummary: getProgressSummary,
        publishProgress: publishProgress,
        applyLanguage: applyLanguage,
        isUiOpen: () => isMapOpen() || isModalOpen(),
        validateLevels: validateLevels,
        syncLeaderboardButton: syncLeaderboardButton,

        // Хуки ядра (game.js -> adventureHook)
        onPlacement: onPlacement,
        onHammerUsed: onHammerUsed,
        onDeadlock: onDeadlock,
        onScoreChanged: onScoreChanged
    };

    // При смене размеров ряд HUD может перевернуться в две строки (или обратно) —
    // бюджет вёрстки пересчитываем, иначе доска не сойдётся по высоте.
    let hudSyncFrameId = 0;
    const scheduleHudSync = () => {
        if (hudSyncFrameId) return;
        hudSyncFrameId = requestAnimationFrame(() => {
            hudSyncFrameId = 0;
            syncHudBudget();
        });
    };
    window.addEventListener('resize', scheduleHudSync);
    window.addEventListener('orientationchange', scheduleHudSync);

    // Проверку гоняем отложенно: adventure.js грузится ДО game.js, а валидатору
    // нужен window.GameCore (палитра цветов для целей colorClear).
    if (window.location
        && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        setTimeout(validateLevels, 0);
    }
})();
