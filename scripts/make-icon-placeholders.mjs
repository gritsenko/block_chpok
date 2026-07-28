/**
 * make-icon-placeholders.mjs — рисует PNG-плейсхолдеры для иконок UI приключения.
 *
 * Зачем: до появления финального арта в интерфейсе стояли эмодзи, которые в каждой ОС
 * выглядят по-своему. Скрипт генерирует пустышки с ПРАВИЛЬНЫМИ именами и размерами —
 * художник заменяет файлы 1:1, CSS и код при этом не меняются.
 *
 * Запуск:  node scripts/make-icon-placeholders.mjs
 * Вывод:   src/assets/theme/icons/*.png
 *
 * ВАЖНО: скрипт ПЕРЕЗАПИСЫВАЕТ существующие файлы. Готовый арт он затрёт, поэтому
 * запускать его нужно только когда добавляется новая иконка (например, новый тип цели):
 * допишите запись в ICONS и удалите из массива те, что уже нарисованы дизайнером.
 *
 * Размеры подобраны как 3x от размера отрисовки в CSS (@3x под retina).
 * Таблица «файл -> где используется -> размер» — в docs/ADVENTURE_MODE.md.
 *
 * Зависимостей нет: PNG пишется вручную (zlib из стандартной библиотеки).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(rootDir, 'src/assets/theme/icons');

// ---------------------------------------------------------------------------
// Мини-PNG (RGBA, 8 бит, без интерлейса)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter type 0
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ---------------------------------------------------------------------------
// Простейший «холст» с альфа-смешиванием и 3x3 сглаживанием
// ---------------------------------------------------------------------------
function createCanvas(size) {
    const data = Buffer.alloc(size * size * 4); // прозрачный
    return {
        size,
        data,
        blend(x, y, [r, g, b], alpha) {
            if (alpha <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
            const i = (y * size + x) * 4;
            const srcA = Math.min(1, alpha);
            const dstA = data[i + 3] / 255;
            const outA = srcA + dstA * (1 - srcA);
            if (outA <= 0) return;
            data[i] = Math.round((r * srcA + data[i] * dstA * (1 - srcA)) / outA);
            data[i + 1] = Math.round((g * srcA + data[i + 1] * dstA * (1 - srcA)) / outA);
            data[i + 2] = Math.round((b * srcA + data[i + 2] * dstA * (1 - srcA)) / outA);
            data[i + 3] = Math.round(outA * 255);
        },
        // Заливает область по предикату «точка внутри», сглаживая границу.
        fill(isInside, color) {
            const samples = 3;
            const step = 1 / samples;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    let hits = 0;
                    for (let sy = 0; sy < samples; sy++) {
                        for (let sx = 0; sx < samples; sx++) {
                            if (isInside(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hits++;
                        }
                    }
                    if (hits > 0) this.blend(x, y, color, hits / (samples * samples));
                }
            }
        }
    };
}

function hex(value) {
    return [
        parseInt(value.slice(1, 3), 16),
        parseInt(value.slice(3, 5), 16),
        parseInt(value.slice(5, 7), 16)
    ];
}

function roundedRectTest(left, top, right, bottom, radius) {
    return (x, y) => {
        if (x < left || x > right || y < top || y > bottom) return false;
        const cx = Math.min(Math.max(x, left + radius), right - radius);
        const cy = Math.min(Math.max(y, top + radius), bottom - radius);
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= radius * radius;
    };
}

function starTest(cx, cy, outer, inner, points = 5) {
    const vertices = [];
    for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        vertices.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    return (x, y) => {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const [xi, yi] = vertices[i];
            const [xj, yj] = vertices[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };
}

// Растровый шрифт 5x7 — только те буквы, что нужны подписям плейсхолдеров.
const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..']
};

function drawLabel(canvas, label, color) {
    const size = canvas.size;
    const scale = Math.max(2, Math.floor(size / 18));
    const glyphW = 5 * scale;
    const glyphH = 7 * scale;
    const gap = scale;
    const totalW = label.length * glyphW + (label.length - 1) * gap;
    const startX = Math.round((size - totalW) / 2);
    const startY = Math.round((size - glyphH) / 2);

    label.split('').forEach((ch, index) => {
        const glyph = FONT[ch];
        if (!glyph) return;
        const originX = startX + index * (glyphW + gap);
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 5; col++) {
                if (glyph[row][col] !== '#') continue;
                for (let dy = 0; dy < scale; dy++) {
                    for (let dx = 0; dx < scale; dx++) {
                        canvas.blend(originX + col * scale + dx, startY + row * scale + dy, color, 1);
                    }
                }
            }
        }
    });
}

// Плашка с подписью: скруглённый квадрат + рамка + две буквы.
function drawBadge(size, fillColor, borderColor, labelColor, label) {
    const canvas = createCanvas(size);
    const pad = Math.max(1, Math.round(size * 0.06));
    const radius = size * 0.22;
    const border = Math.max(2, Math.round(size / 22));

    canvas.fill(roundedRectTest(pad, pad, size - pad, size - pad, radius), hex(borderColor));
    canvas.fill(
        roundedRectTest(pad + border, pad + border, size - pad - border, size - pad - border, Math.max(1, radius - border)),
        hex(fillColor)
    );
    drawLabel(canvas, label, hex(labelColor));
    return encodePng(size, size, canvas.data);
}

function drawStar(size, fillColor, borderColor) {
    const canvas = createCanvas(size);
    const center = size / 2;
    const outer = size * 0.47;
    canvas.fill(starTest(center, center, outer, outer * 0.44), hex(borderColor));
    canvas.fill(starTest(center, center, outer * 0.86, outer * 0.38), hex(fillColor));
    return encodePng(size, size, canvas.data);
}

// ---------------------------------------------------------------------------
// Список иконок. size — размер файла (3x от отрисовки), label — подпись плейсхолдера.
// ---------------------------------------------------------------------------
const GOAL = { fill: '#f6d6a3', border: '#9b6134', label: '#5b311d' };
const HUD = { fill: '#f7b9b9', border: '#b03a3a', label: '#5a1616' };
const BOOSTER = { fill: '#cfe6ff', border: '#2e6f9e', label: '#14384f' };
const NEUTRAL = { fill: '#e2dcd4', border: '#7c746c', label: '#3d3833' };

const ICONS = [
    // Чипы целей — отрисовка 16x16 (22x22 в списке целей модалки)
    { file: 'icon-goal-score.png', size: 48, label: 'SC', theme: GOAL },
    { file: 'icon-goal-lines.png', size: 48, label: 'LN', theme: GOAL },
    { file: 'icon-goal-blocks.png', size: 48, label: 'BL', theme: GOAL },
    { file: 'icon-goal-crate.png', size: 48, label: 'CR', theme: GOAL },
    { file: 'icon-goal-ice.png', size: 48, label: 'IC', theme: GOAL },
    { file: 'icon-goal-gem.png', size: 48, label: 'GM', theme: GOAL },
    { file: 'icon-goal-bomb.png', size: 48, label: 'BM', theme: GOAL },
    { file: 'icon-goal-combo.png', size: 48, label: 'CB', theme: GOAL },
    { file: 'icon-goal-placements.png', size: 48, label: 'PC', theme: GOAL },
    { file: 'icon-goal-color.png', size: 48, label: 'CL', theme: GOAL },

    // HUD — отрисовка 13x13 и 16x16
    { file: 'icon-moves.png', size: 48, label: 'MV', theme: BOOSTER },
    { file: 'icon-heart.png', size: 48, label: 'HP', theme: HUD },

    // Карта и рейтинг — отрисовка 24x24 / 26x26
    { file: 'icon-lock.png', size: 72, label: 'LK', theme: NEUTRAL },
    { file: 'icon-trophy.png', size: 72, label: 'TR', theme: GOAL },

    // Бустеры — отрисовка 30x30 (24x24 на низких экранах)
    { file: 'icon-booster-hammer.png', size: 96, label: 'HM', theme: BOOSTER },
    { file: 'icon-booster-shuffle.png', size: 96, label: 'SH', theme: BOOSTER },

    // Аватар-заглушка в лидерборде — отрисовка 20x20
    { file: 'icon-avatar-placeholder.png', size: 96, label: 'AV', theme: NEUTRAL }
];

// Звёзды — отрисовка от 11x11 (карта) до 38x38 (экран победы), поэтому 128px.
const STARS = [
    { file: 'icon-star-filled.png', size: 128, fill: '#ffd24a', border: '#c98a1e' },
    { file: 'icon-star-empty.png', size: 128, fill: '#d8cfc4', border: '#9a9086' }
];

mkdirSync(outDir, { recursive: true });

let written = 0;
for (const icon of ICONS) {
    const png = drawBadge(icon.size, icon.theme.fill, icon.theme.border, icon.theme.label, icon.label);
    writeFileSync(resolve(outDir, icon.file), png);
    written++;
}
for (const star of STARS) {
    writeFileSync(resolve(outDir, star.file), drawStar(star.size, star.fill, star.border));
    written++;
}

console.log(`Wrote ${written} icon placeholders to src/assets/theme/icons`);
