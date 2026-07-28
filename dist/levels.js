/*
 * ============================================================================
 *  levels.js — контент режима «Приключение» (Adventure mode)
 * ============================================================================
 *
 *  Файл подключается обычным <script src="levels.js"> и определяет ровно два
 *  глобальных объекта:
 *
 *    window.ADVENTURE_CHAPTERS — 4 главы: { id, from, to, name: { ru, en }, bg }
 *                                bg — фон главы на карте (кроссфейд при прокрутке)
 *    window.ADVENTURE_LEVELS   — 40 уровней, id 1..40 строго по порядку.
 *
 *  Формат уровня:
 *    {
 *        id:     порядковый номер (1..40),
 *        name:   { ru, en } — короткое название, 1-3 слова,
 *        moves:  жёсткий лимит размещений (8..30),
 *        goals:  цели уровня; для победы нужно выполнить ВСЕ:
 *                  score      — набрать столько очков
 *                  lines      — собрать столько линий (2 за один ход = 2)
 *                  blocks     — очистить столько отдельных блоков
 *                  crates     — разбить столько ящиков (число или 'all')
 *                  ice        — растопить столько льда (число или 'all')
 *                  gems       — собрать столько самоцветов (число или 'all')
 *                  bombs      — 'all': обезвредить все бомбы на доске
 *                  combo      — серия из N подряд ходов, каждый с очисткой
 *                  placements — успешно поставить N фигур («выживание»)
 *                  colorClear — { color, count }: очистить N блоков цвета
 *                               (red / blue / green / purple / yellow / orange)
 *        layout: НЕОБЯЗАТЕЛЬНО. Ровно 8 строк по 8 символов, ряд 0 — верхний.
 *                Если поля нет — стартовая доска пустая.
 *        hint:   { ru, en } — одна короткая тактическая подсказка,
 *        shapes: НЕОБЯЗАТЕЛЬНО: 'small' | 'big' | 'lines' — особый пул фигур
 *                (по умолчанию 'all', поле в этом случае не указывается).
 *    }
 *
 *  Легенда символов layout:
 *    .            пустая клетка, можно ставить фигуры
 *    #            дыра в доске: ставить нельзя, клетка ИСКЛЮЧЕНА из линий
 *                 (ряд с двумя дырами закрывается шестью клетками)
 *    *            стартовый блок случайного цвета
 *    r g b y p o  стартовый блок фиксированного цвета:
 *                 red, green, blue, yellow, purple, orange
 *    s S T        камень на 1 / 2 / 3 удара: занимает клетку, СЧИТАЕТСЯ
 *                 заполненным для линий, скалывается очисткой линии сквозь
 *                 него; на 0 ударов исчезает
 *    c C          ящик на 1 / 2 удара: механика камня, но отслеживается
 *                 целью `crates`
 *    i I          лёд на 1 / 2 удара: клетка ПУСТАЯ и доступна для фигур,
 *                 тает при очистке линии, накрывающей эту клетку; цель `ice`
 *    d            самоцвет: стартовый цветной блок с камнем внутри,
 *                 добывается очисткой линии; цель `gems`
 *    1..9         бомба с обратным отсчётом: занимает клетку и считается
 *                 заполненной; счётчик падает на 1 после КАЖДОГО хода;
 *                 очистка линии сквозь бомбу обезвреживает её;
 *                 счётчик 0 = мгновенное поражение
 *
 *  Правила для дизайнеров новых уровней:
 *    — никогда не создавайте стартовых уже готовых линий;
 *    — держите не меньше ~55% свободных клеток (не считая дыр);
 *    — каждая цель со значением 'all' обязана иметь соответствующие
 *      символы в layout;
 *    — линия из одних камней сама не очищается: в линии должен быть
 *      хотя бы один цветной блок.
 * ============================================================================
 */

// bg сопоставлен по СОДЕРЖИМОМУ арта: в присланных файлах имена глав 2 и 3
// перепутаны — в evening_parlor.jpg нарисована кладовая, в snug_pantry.jpg гостиная.
window.ADVENTURE_CHAPTERS = [
    { id: 1, from: 1,  to: 10, name: { ru: 'Тёплая кухня',      en: 'Cozy Kitchen' },     bg: 'assets/maps/cozy_kitchen.jpg' },
    { id: 2, from: 11, to: 20, name: { ru: 'Уютная кладовая',   en: 'Snug Pantry' },      bg: 'assets/maps/evening_parlor.jpg' },
    { id: 3, from: 21, to: 30, name: { ru: 'Вечерняя гостиная', en: 'Evening Parlor' },   bg: 'assets/maps/snug_pantry.jpg' },
    { id: 4, from: 31, to: 40, name: { ru: 'Домик на ветке',    en: 'Branch Hideaway' },  bg: 'assets/maps/branch_hidaway.jpg' }
];

window.ADVENTURE_LEVELS = [

    // ─── Глава 1: Тёплая кухня (1-10) — основы, дыры, камни, первый ящик ───

    {
        id: 1,
        name: { ru: 'Первые крошки', en: 'First Crumbs' },
        moves: 14,
        goals: { score: 900 },
        layout: [
            '........',
            '........',
            '..*..*..',
            '........',
            '........',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Ставь фигуры плотнее — линии копятся сами.', en: 'Pack pieces tight — lines add up.' }
    },
    {
        id: 2,
        name: { ru: 'Разминка', en: 'Warm-Up' },
        moves: 16,
        goals: { lines: 4 },
        hint: { ru: 'Заполняй ряды от края — так проще не запутаться.', en: 'Build rows from the edge to stay tidy.' }
    },
    {
        id: 3,
        name: { ru: 'Свежая выпечка', en: 'Fresh Bake' },
        moves: 18,
        goals: { score: 1000, lines: 4 },
        layout: [
            '........',
            '........',
            '.*....*.',
            '........',
            '........',
            '.*....*.',
            '........',
            '........'
        ],
        hint: { ru: 'Ряд и столбец разом дают больше очков.', en: 'A row and a column together score big.' }
    },
    {
        id: 4,
        name: { ru: 'Открытое окно', en: 'Open Window' },
        moves: 16,
        goals: { lines: 4 },
        layout: [
            '##....##',
            '##....##',
            '........',
            '........',
            '........',
            '........',
            '##....##',
            '##....##'
        ],
        hint: { ru: 'Короткие ряды у углов закрываются парой клеток.', en: 'Corner rows are short — a few cells finish them.' }
    },
    {
        id: 5,
        name: { ru: 'Пирог с изюмом', en: 'Raisin Pie' },
        moves: 18,
        goals: { score: 1100 },
        layout: [
            '........',
            '.*....*.',
            '........',
            '...**...',
            '...**...',
            '........',
            '.*....*.',
            '........'
        ],
        hint: { ru: 'Изюминки уже стоят — достраивай их ряды.', en: 'Raisins are placed — finish their rows.' }
    },
    {
        id: 6,
        name: { ru: 'Пряничный ромб', en: 'Gingerbread Diamond' },
        moves: 18,
        goals: { lines: 5 },
        layout: [
            '###..###',
            '##....##',
            '#......#',
            '...gg...',
            '...gg...',
            '#......#',
            '##....##',
            '###..###'
        ],
        hint: { ru: 'В узких рядах ромба хватит одной фигуры.', en: 'One piece can fill a narrow diamond row.' }
    },
    {
        id: 7,
        name: { ru: 'Первые камешки', en: 'First Pebbles' },
        moves: 16,
        goals: { lines: 4 },
        layout: [
            '........',
            '...s....',
            '........',
            '...s....',
            '........',
            '...s....',
            '........',
            '........'
        ],
        hint: { ru: 'Камни считаются заполненными — строй вокруг них.', en: 'Rocks count as filled — build around them.' }
    },
    {
        id: 8,
        name: { ru: 'Каменное колечко', en: 'Stone Ring' },
        moves: 18,
        goals: { lines: 5 },
        layout: [
            'S......S',
            '........',
            '..ssss..',
            '..s..s..',
            '..s..s..',
            '..ssss..',
            '........',
            'S......S'
        ],
        hint: { ru: 'Линия сквозь камень откалывает его.', en: 'A line through a rock chips it away.' }
    },
    {
        id: 9,
        name: { ru: 'Печенька', en: 'The Cookie' },
        moves: 12,
        goals: { crates: 'all' },
        layout: [
            '........',
            '........',
            '...ss...',
            '..sc.s..',
            '..s..s..',
            '...ss...',
            '........',
            '........'
        ],
        hint: { ru: 'Собери линию сквозь ящик, чтобы разбить его.', en: 'Clear a line through the crate to smash it.' }
    },
    {
        id: 10,
        name: { ru: 'Полка с запасами', en: 'Stocked Shelves' },
        moves: 15,
        goals: { crates: 'all', lines: 3 },
        layout: [
            '........',
            '.cs..sc.',
            '........',
            '........',
            '.cs..sc.',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Столбец сквозь два ящика бьёт оба сразу.', en: 'One column through two crates hits both.' }
    },

    // ─── Глава 2: Уютная кладовая (11-20) — ящики, лёд, самоцветы, комбо ───

    {
        id: 11,
        name: { ru: 'Лесенка из ящиков', en: 'Crate Staircase' },
        moves: 16,
        goals: { crates: 5 },
        layout: [
            'c.......',
            '.c......',
            '..c.....',
            '...c....',
            '....c...',
            '.....c..',
            '......c.',
            '.......c'
        ],
        hint: { ru: 'Каждый ряд лесенки прячет один ящик.', en: 'Every staircase row hides one crate.' }
    },
    {
        id: 12,
        name: { ru: 'Крепкие ящики', en: 'Tough Crates' },
        moves: 18,
        goals: { crates: 'all' },
        layout: [
            '........',
            '........',
            '...CC...',
            '..cCCc..',
            '...cc...',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Крепким ящикам нужно два удара — бей столбцы дважды.', en: 'Tough crates take two hits — clear columns twice.' }
    },
    {
        id: 13,
        name: { ru: 'Тиски', en: 'The Vise' },
        moves: 13,
        goals: { crates: 'all', lines: 4 },
        layout: [
            '........',
            '........',
            '##....##',
            '##C..C##',
            '##C..C##',
            '##....##',
            '........',
            '........'
        ],
        hint: { ru: 'Средним рядам не хватает всего двух клеток.', en: 'Middle rows need just two cells to clear.' }
    },
    {
        id: 14,
        name: { ru: 'Ромб из ящиков', en: 'Crate Diamond' },
        moves: 15,
        goals: { crates: 'all' },
        layout: [
            '........',
            '....c...',
            '...c.c..',
            '..c.C.c.',
            '...c.c..',
            '....c...',
            '........',
            '........'
        ],
        hint: { ru: 'Ряды ромба бьют по два ящика за раз.', en: 'Diamond rows smash two crates at once.' }
    },
    {
        id: 15,
        name: { ru: 'Первый лёд', en: 'First Frost' },
        moves: 12,
        goals: { ice: 'all' },
        layout: [
            '........',
            '........',
            '...ii...',
            '...ii...',
            '........',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Накрой лёд фигурой и собери эту линию.', en: 'Cover the ice, then clear that line.' }
    },
    {
        id: 16,
        name: { ru: 'Морозные полки', en: 'Frosty Shelves' },
        moves: 15,
        goals: { ice: 'all' },
        layout: [
            '........',
            'o.iii..o',
            '........',
            '........',
            'g..III.g',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Толстый лёд тает только со второго раза.', en: 'Thick ice needs a second clear to melt.' }
    },
    {
        id: 17,
        name: { ru: 'Ледник', en: 'The Icebox' },
        moves: 18,
        goals: { ice: 'all', lines: 5 },
        layout: [
            '........',
            '..ssss..',
            '.siiiis.',
            '.siiiis.',
            '..ssss..',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Камни помогают: ряды со льдом почти собраны.', en: 'Rocks help — the icy rows are nearly full.' }
    },
    {
        id: 18,
        name: { ru: 'Тайник самоцветов', en: 'Gem Stash' },
        moves: 12,
        goals: { gems: 'all' },
        layout: [
            '........',
            '...d....',
            '..*.*...',
            '.d...d..',
            '..*.*...',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Самоцвет добывается линией через его клетку.', en: 'Clear a line through a gem to collect it.' }
    },
    {
        id: 19,
        name: { ru: 'Три подряд', en: 'Triple Streak' },
        moves: 14,
        goals: { combo: 3 },
        layout: [
            '........',
            'rrr...rr',
            '........',
            'bb...bbb',
            '........',
            'pppp...p',
            '........',
            '........'
        ],
        hint: { ru: 'Подготовь все ряды, потом добивай их подряд.', en: 'Prep every row, then finish them back-to-back.' }
    },
    {
        id: 20,
        name: { ru: 'Сундук самоцветов', en: 'Treasure Chest' },
        moves: 17,
        goals: { gems: 'all', crates: 'all' },
        layout: [
            '........',
            '........',
            '..cccc..',
            '..cddc..',
            '..cddc..',
            '..cccc..',
            '........',
            '........'
        ],
        hint: { ru: 'Ряды сундука бьют ящики и достают самоцветы.', en: 'Chest rows smash crates and free the gems.' }
    },

    // ─── Глава 3: Вечерняя гостиная (21-30) — бомбы, миксы, цвета и пулы фигур ───

    {
        id: 21,
        name: { ru: 'Тик-так', en: 'Tick-Tock' },
        moves: 10,
        goals: { bombs: 'all' },
        layout: [
            '........',
            '........',
            '........',
            '.ggg8gg.',
            '........',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Ряду с бомбой не хватает двух клеток — успей!', en: 'The bomb row needs two cells — be quick!' }
    },
    {
        id: 22,
        name: { ru: 'Двойной фитиль', en: 'Double Fuse' },
        moves: 12,
        goals: { bombs: 'all' },
        layout: [
            '........',
            '.pp.7pp.',
            '........',
            '........',
            '.oo9.oo.',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Сначала гаси бомбу с меньшим числом.', en: 'Defuse the lower-numbered bomb first.' }
    },
    {
        id: 23,
        name: { ru: 'Ущелье', en: 'The Gorge' },
        moves: 12,
        goals: { bombs: 'all' },
        layout: [
            '........',
            '##.6..##',
            '##....##',
            '##....##',
            '##....##',
            '##..9.##',
            '##....##',
            '........'
        ],
        hint: { ru: 'Дыры укорачивают ряды — гаси бомбы быстрее.', en: 'Voids shorten rows — defuse bombs faster.' }
    },
    {
        id: 24,
        name: { ru: 'Пороховой погреб', en: 'Powder Cellar' },
        moves: 14,
        goals: { bombs: 'all', lines: 4 },
        layout: [
            '........',
            '..s8s...',
            '........',
            '....s7s.',
            '........',
            '.s9s....',
            '........',
            '........'
        ],
        hint: { ru: 'Длинные линии закрывают ряды бомб за пару ходов.', en: 'Long lines finish bomb rows in two moves.' }
    },
    {
        id: 25,
        name: { ru: 'Старый буфет', en: 'Old Cupboard' },
        moves: 16,
        goals: { crates: 'all', ice: 'all' },
        layout: [
            '........',
            '.s.ss.s.',
            '........',
            '..iIIi..',
            '........',
            '.c.cc.c.',
            '........',
            '........'
        ],
        hint: { ru: 'У каждой полки свой трюк — иди ряд за рядом.', en: 'Each shelf has a trick — go row by row.' }
    },
    {
        id: 26,
        name: { ru: 'Каменная арка', en: 'Stone Arch' },
        moves: 12,
        goals: { crates: 'all', ice: 'all', placements: 10 },
        layout: [
            '##....##',
            '#..ss..#',
            '#.c..c.#',
            '#.i..i.#',
            '#......#',
            '#......#',
            '........',
            '........'
        ],
        hint: { ru: 'Узкие ряды арки собираются четырьмя клетками.', en: 'Narrow arch rows need only four cells.' }
    },
    {
        id: 27,
        name: { ru: 'Забытый угол', en: 'Forgotten Corner' },
        moves: 16,
        goals: { ice: 'all', crates: 'all', blocks: 28 },
        layout: [
            'i..s..i.',
            '........',
            's..c..s.',
            '........',
            'i..s..i.',
            '........',
            's..c..s.',
            '........'
        ],
        hint: { ru: 'Столбцы бьют сразу по несколько целей.', en: 'Columns hit several targets at once.' }
    },
    {
        id: 28,
        name: { ru: 'Синий сервиз', en: 'Blue China' },
        moves: 18,
        goals: { colorClear: { color: 'blue', count: 12 } },
        shapes: 'small',
        layout: [
            '.b....b.',
            '........',
            '..b..b..',
            '........',
            '..b..b..',
            '........',
            '.b....b.',
            '........'
        ],
        hint: { ru: 'Синие — это квадрат 2×2 и линия 1×4.', en: 'Blue means the 2x2 square and the 1x4 line.' }
    },
    {
        id: 29,
        name: { ru: 'Коридоры', en: 'The Corridors' },
        moves: 16,
        goals: { lines: 6 },
        shapes: 'lines',
        layout: [
            '#..##..#',
            '#..##..#',
            '#..##..#',
            '........',
            '........',
            '#..##..#',
            '#..##..#',
            '#..##..#'
        ],
        hint: { ru: 'Ставь длинные линии вдоль колонн.', en: 'Lay long lines along the pillars.' }
    },
    {
        id: 30,
        name: { ru: 'Ягодный торт', en: 'Berry Cake' },
        moves: 18,
        goals: { colorClear: { color: 'red', count: 12 }, gems: 'all' },
        layout: [
            '........',
            '...dd...',
            '........',
            '..rrrr..',
            '........',
            '.rr..rr.',
            '........',
            '........'
        ],
        hint: { ru: 'Красный дают ягоды и большой квадрат 3×3.', en: 'Red comes from berries and the 3x3 square.' }
    },

    // ─── Глава 4: Домик на ветке (31-40) — жёсткие комбинации и боссы ───

    {
        id: 31,
        name: { ru: 'Скрещённые ветки', en: 'Crossed Branches' },
        moves: 15,
        goals: { bombs: 'all', lines: 5 },
        layout: [
            's......s',
            '.s....s.',
            '..s..s..',
            '...88...',
            '..s..s..',
            '.s....s.',
            's......s',
            '........'
        ],
        hint: { ru: 'Обе бомбы в одном ряду — один взмах гасит их.', en: 'Both bombs share a row — one clear defuses them.' }
    },
    {
        id: 32,
        name: { ru: 'Ледяной клад', en: 'Frozen Hoard' },
        moves: 18,
        goals: { crates: 'all', ice: 'all' },
        layout: [
            '........',
            '..iiii..',
            '..CccC..',
            '..c..c..',
            '..cccc..',
            '........',
            '........',
            '........'
        ],
        hint: { ru: 'Растопи лёд, потом дважды пройдись по углам.', en: 'Melt the ice, then hit the corners twice.' }
    },
    {
        id: 33,
        name: { ru: 'Пламя и иней', en: 'Flame and Frost' },
        moves: 15,
        goals: { bombs: 'all', ice: 'all' },
        layout: [
            '........',
            'p.ii7..p',
            '........',
            '........',
            'o..ii9.o',
            '........',
            '...ii...',
            '........'
        ],
        hint: { ru: 'Накрывай лёд в ряду бомбы — двойная выгода.', en: 'Cover ice in the bomb row — a double win.' }
    },
    {
        id: 34,
        name: { ru: 'Каменное сердце', en: 'Stone Heart' },
        moves: 17,
        goals: { gems: 'all', lines: 6 },
        layout: [
            '.ss..ss.',
            'sd.ss.ds',
            's......s',
            '.s....s.',
            '..s..s..',
            '...ss...',
            '........',
            '........'
        ],
        hint: { ru: 'Ряду с самоцветами не хватает двух клеток.', en: 'The gem row is two cells from clearing.' }
    },
    {
        id: 35,
        name: { ru: 'Штурм крепости', en: 'Storm the Fort' },
        moves: 22,
        goals: { bombs: 'all', crates: 'all', gems: 'all' },
        layout: [
            '##....##',
            '#.cccc.#',
            '..c..c..',
            '..cddc..',
            '..c..c..',
            '..cccc..',
            '#..99..#',
            '........'
        ],
        hint: { ru: 'Столбцы стен рушат по пять ящиков за раз.', en: 'Wall columns crush five crates at once.' }
    },
    {
        id: 36,
        name: { ru: 'Большие брёвна', en: 'Big Timbers' },
        moves: 18,
        goals: { score: 1800, lines: 7 },
        shapes: 'big',
        layout: [
            '...ss...',
            '........',
            's......s',
            '........',
            '........',
            's......s',
            '........',
            '...ss...'
        ],
        hint: { ru: 'Большим фигурам нужен простор — думай заранее.', en: 'Big pieces need room — plan ahead.' }
    },
    {
        id: 37,
        name: { ru: 'Цепная реакция', en: 'Chain Reaction' },
        moves: 14,
        goals: { combo: 4, score: 1300 },
        layout: [
            'rrr..rrr',
            '........',
            'pp..pppp',
            '........',
            'oooo..oo',
            '........',
            'ggggg..g',
            '........'
        ],
        hint: { ru: 'Каждому ряду не хватает двух клеток — держи серию.', en: 'Each row lacks two cells — keep the streak.' }
    },
    {
        id: 38,
        name: { ru: 'Обратный отсчёт', en: 'Final Countdown' },
        moves: 14,
        goals: { bombs: 'all', lines: 5 },
        layout: [
            '........',
            '######6.',
            '........',
            '........',
            '###8....',
            '........',
            '9.......',
            '........'
        ],
        hint: { ru: 'Верхняя бомба гаснет одной клеткой — начни с неё.', en: 'One cell defuses the top bomb — start there.' }
    },
    {
        id: 39,
        name: { ru: 'Песочные часы', en: 'The Hourglass' },
        moves: 17,
        goals: { crates: 'all', ice: 'all', lines: 6 },
        layout: [
            '..cccc..',
            '........',
            '#.y..y.#',
            '##.ii.##',
            '##.ii.##',
            '#.y..y.#',
            '........',
            '..ssss..'
        ],
        hint: { ru: 'Квадрат 2×2 накрывает весь лёд в горловине.', en: 'A 2x2 covers all the ice in the neck.' }
    },
    {
        id: 40,
        name: { ru: 'Дом хомяка', en: 'Hamster\'s Home' },
        moves: 24,
        goals: { bombs: 'all', crates: 'all', ice: 'all', gems: 'all' },
        layout: [
            '...ss...',
            '..s..s..',
            '.s....s.',
            '.c.dd.c.',
            '.c....c.',
            '.cIiiIc.',
            '.c.99.c.',
            '........'
        ],
        hint: { ru: 'Сначала дверь с бомбами, потом стены и чердак.', en: 'Bomb door first, then the walls and attic.' }
    }
];

// Итого: 40 уровней в 4 главах. Новые уровни добавляются в конец массива
// с очередным id; диапазон главы указывается в ADVENTURE_CHAPTERS.
