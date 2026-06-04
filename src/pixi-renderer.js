/* pixi-renderer.js — WebGL-рендер ДИНАМИКИ игрового поля на PixiJS v7.
 *
 * Зачем: DOM-оптимизация не дала плавности — главные источники просадок это
 * `filter: drop-shadow` на блоках (ре-растеризация фильтра в кадре), попиксельная
 * перерисовка превью (классы/инлайн-фон на ~22 ячейках за движение) и анимация
 * сжигания линий на фильтрованных DOM-узлах. Этот модуль рисует блоки доски,
 * превью установки, подсветку линий и анимации (popIn/blast) в одном WebGL-канвасе,
 * который перекрывает только `.board`.
 *
 * Принципы:
 *  - Только презентация. Ввод и вся игровая логика остаются в game.js.
 *  - Канвас прозрачный и `pointer-events:none`; пустые ячейки и рамка доски — это
 *    по-прежнему DOM (плитка `.cell`, рамка `.board`), поэтому внешний вид пустого
 *    поля и скруглённые углы 1:1 как раньше. Pixi рисует ТОЛЬКО блоки/превью/анимации.
 *  - Трей и перетаскиваемая фигура остаются DOM (они не узкое место).
 *  - Нулевые аллокации в горячих путях: пулы спрайтов, переключаем visible/texture/tint.
 *  - Координаты сцены = CSS-пиксели (autoDensity + resolution=dpr), поэтому геометрия
 *    совпадает с hit-testing в game.js (cellSize = boardWidth / 8, gap 0).
 *
 * Публичный API (window.pixiRenderer):
 *   init(opts) -> Promise<boolean>   // opts: { boardContainer, boardEl, boardSize,
 *                                    //   blockTextures:{token:url}, getColorAt:(r,c)=>token|null,
 *                                    //   lowPerf, deviceMemory, onContextLost, onContextRestored }
 *   ready: Promise<boolean>
 *   available: boolean
 *   cellSize: number
 *   layout()                         // пересчёт геометрии под текущий размер .board
 *   syncBoard()                      // дифф board-модели -> спрайты (popIn на новых)
 *   drawPreview(shape, r, c, tint, rows, cols)
 *   clearPreview()
 *   blastCell(r, c)                  // анимация сжигания одной ячейки
 *   start() / stop()                 // lifecycle (пауза/возобновление тикера)
 *   requestRender()                  // одноразовый рендер (когда нет активных твинов)
 */
(function () {
    'use strict';

    const PIXI = window.PIXI;
    const BLOCK_SCALE = 1.28; // зеркалит CSS background-size:128% у .block-item
    const FALLBACK_TOKEN = 'var(--color-purple)';

    const renderer = {
        available: false,
        ready: Promise.resolve(false),
        cellSize: 0
    };
    window.pixiRenderer = renderer;

    let app = null;
    let boardEl = null;
    let containerEl = null;
    let BOARD = 8;
    let getColorAt = function () { return null; };
    let blockTextureUrls = {};
    let lowPerf = false;
    let onContextLost = null;
    let onContextRestored = null;

    // Слои сцены (зад -> перёд)
    let blockLayer = null;
    let previewLayer = null;
    let clearLayer = null;

    // Пулы
    const blockSprites = [];   // [r*BOARD+c] -> Sprite (блок доски)
    const renderedColor = [];  // [idx] -> token|null (источник диффа)
    const previewPool = [];    // спрайты-призраки (полупрозрачные)
    const lineHighlightPool = []; // спрайты подсветки линий
    let previewUsed = 0;
    let lineUsed = 0;
    const blasting = new Set(); // индексы ячеек в процессе blast-анимации

    // Текстуры
    const textures = {};       // token -> Texture

    // Геометрия (в CSS-пикселях, локально к канвасу = к .board)
    let cellPx = 0;
    let stepPx = 0;            // cellPx + gap (gap на доске = 0)

    // Твины / рендер
    const tweens = [];
    let tickerRunning = false;
    let renderScheduled = false;

    function idx(r, c) { return r * BOARD + c; }

    function hasWebGL() {
        if (!PIXI) return false;
        try {
            const c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('PixiRenderer: Assets.load timeout')); }, ms);
            })
        ]);
    }

    // ---- Тикер: крутится только пока есть активные твины; иначе одноразовый рендер ----
    function ensureTicker() {
        if (!renderer.available) return;
        if (!tickerRunning) { app.ticker.start(); tickerRunning = true; }
    }

    function stopTicker() {
        if (tickerRunning) { app.ticker.stop(); tickerRunning = false; }
    }

    function tickerTick() {
        const dms = app.ticker.deltaMS;
        let active = false;
        for (let i = 0; i < tweens.length; i++) {
            const t = tweens[i];
            if (t.done) continue;
            t.elapsed += dms;
            const p = t.dur > 0 ? Math.min(1, t.elapsed / t.dur) : 1;
            try { t.onUpdate(p); } catch (e) { /* не валим кадр */ }
            if (p >= 1) {
                t.done = true;
                if (t.onComplete) { try { t.onComplete(); } catch (e) { } }
            } else {
                active = true;
            }
        }
        if (!active) tweens.length = 0;
        app.renderer.render(app.stage);
        if (!active) stopTicker();
    }

    function requestRender() {
        if (!renderer.available) return;
        if (tickerRunning) return;        // тикер сам отрисует кадр
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(function () {
            renderScheduled = false;
            if (renderer.available && !tickerRunning) {
                app.renderer.render(app.stage);
            }
        });
    }
    renderer.requestRender = requestRender;

    function tween(dur, onUpdate, onComplete) {
        const t = { dur: dur, onUpdate: onUpdate, onComplete: onComplete, elapsed: 0, done: false };
        tweens.push(t);
        ensureTicker();
        return t;
    }

    function easeOutBack(p) {
        const s = 1.70158;
        const t = p - 1;
        return 1 + (s + 1) * t * t * t + s * t * t;
    }

    // ---- Геометрия ----
    function placeBlock(sp, r, c) {
        sp.position.set(c * stepPx + cellPx / 2, r * stepPx + cellPx / 2);
        sp.width = cellPx * BLOCK_SCALE;
        sp.height = cellPx * BLOCK_SCALE;
    }

    function placeCell(sp, r, c) {
        sp.position.set(c * stepPx + cellPx / 2, r * stepPx + cellPx / 2);
        sp.width = cellPx;
        sp.height = cellPx;
    }

    function textureFor(token) {
        return textures[token] || textures[FALLBACK_TOKEN] || PIXI.Texture.WHITE;
    }

    // ---- Построение слоёв и пулов ----
    function buildScene() {
        blockLayer = new PIXI.Container();
        previewLayer = new PIXI.Container();
        clearLayer = new PIXI.Container();
        app.stage.addChild(blockLayer, previewLayer, clearLayer);

        const n = BOARD * BOARD;
        for (let i = 0; i < n; i++) {
            const b = new PIXI.Sprite(PIXI.Texture.EMPTY);
            b.anchor.set(0.5);
            b.visible = false;
            blockLayer.addChild(b);
            blockSprites.push(b);
            renderedColor.push(null);
        }
        // Превью: максимум заполненных клеток у фигуры — 9 (3x3).
        for (let i = 0; i < 9; i++) {
            previewPool.push(makeOverlaySprite(previewLayer));
        }
        // Подсветка линий растёт лениво (getLineSprite).
    }

    function makeOverlaySprite(layer) {
        const sp = new PIXI.Sprite(PIXI.Texture.WHITE);
        sp.anchor.set(0.5);
        sp.visible = false;
        layer.addChild(sp);
        return sp;
    }

    function getPreviewSprite(i) {
        let sp = previewPool[i];
        if (!sp) { sp = makeOverlaySprite(previewLayer); previewPool[i] = sp; }
        return sp;
    }

    function getLineSprite(i) {
        let sp = lineHighlightPool[i];
        if (!sp) { sp = makeOverlaySprite(previewLayer); lineHighlightPool[i] = sp; }
        return sp;
    }

    // ---- Публичные методы рендера ----
    renderer.syncBoard = function () {
        if (!renderer.available) return;
        for (let r = 0; r < BOARD; r++) {
            for (let c = 0; c < BOARD; c++) {
                const i = idx(r, c);
                const token = getColorAt(r, c);
                if (token === renderedColor[i]) continue;

                const sp = blockSprites[i];
                if (token) {
                    // Ячейка стала занятой (или сменила цвет) -> показываем блок.
                    const wasEmpty = renderedColor[i] === null;
                    sp.texture = textureFor(token);
                    placeBlock(sp, r, c);
                    sp.alpha = 1;
                    sp.visible = true;
                    blasting.delete(i);
                    if (wasEmpty) popIn(sp);
                    renderedColor[i] = token;
                } else {
                    // Ячейка стала пустой. Если идёт blast — пусть анимация сама скроет.
                    if (blasting.has(i)) continue;
                    sp.visible = false;
                    sp.texture = PIXI.Texture.EMPTY;
                    renderedColor[i] = null;
                }
            }
        }
        requestRender();
    };

    function popIn(sp) {
        const full = sp.scale.x;
        const dur = lowPerf ? 120 : 200;
        sp.alpha = 0;
        sp.scale.set(full * 0.5);
        tween(dur, function (p) {
            const e = easeOutBack(p);
            sp.scale.set(full * (0.5 + 0.5 * e));
            sp.alpha = Math.min(1, p * 1.6);
        }, function () {
            sp.scale.set(full);
            sp.alpha = 1;
        });
    }

    renderer.blastCell = function (r, c) {
        if (!renderer.available) return;
        const i = idx(r, c);
        const sp = blockSprites[i];
        if (!sp.visible) return;
        const full = sp.scale.x;
        blasting.add(i);
        const dur = lowPerf ? 180 : 260;
        tween(dur, function (p) {
            // scale 1 -> 1.1 (на ~45%) -> 0; alpha 1 -> 0 (зеркалит keyframe blast)
            const mul = p < 0.45 ? (1 + 0.1 * (p / 0.45)) : (1.1 * (1 - (p - 0.45) / 0.55));
            sp.scale.set(full * Math.max(0, mul));
            sp.alpha = Math.max(0, 1 - p);
        }, function () {
            sp.visible = false;
            sp.alpha = 1;
            sp.scale.set(full);
            sp.texture = PIXI.Texture.EMPTY;
            blasting.delete(i);
            renderedColor[i] = null;
        });
    };

    renderer.drawPreview = function (shape, startR, startC, tint, rows, cols) {
        if (!renderer.available) return;
        clearPreviewInternal();
        if (!shape || !shape.matrix) { requestRender(); return; }

        const m = shape.matrix;
        let pi = 0;
        for (let r = 0; r < m.length; r++) {
            const row = m[r];
            if (!row) continue;
            for (let c = 0; c < row.length; c++) {
                if (row[c]) {
                    const sp = getPreviewSprite(pi++);
                    placeCell(sp, startR + r, startC + c);
                    sp.tint = tint;
                    sp.alpha = 0.5;
                    sp.visible = true;
                }
            }
        }
        previewUsed = pi;

        let li = 0;
        if ((rows && rows.length) || (cols && cols.length)) {
            const seen = new Set();
            const add = function (rr, cc) {
                const k = rr * BOARD + cc;
                if (seen.has(k)) return;
                seen.add(k);
                const sp = getLineSprite(li++);
                placeCell(sp, rr, cc);
                sp.tint = tint;
                sp.alpha = 0.55;
                sp.visible = true;
            };
            if (rows) for (let ri = 0; ri < rows.length; ri++) {
                for (let cc = 0; cc < BOARD; cc++) add(rows[ri], cc);
            }
            if (cols) for (let ci = 0; ci < cols.length; ci++) {
                for (let rr = 0; rr < BOARD; rr++) add(rr, cols[ci]);
            }
        }
        lineUsed = li;
        requestRender();
    };

    function clearPreviewInternal() {
        for (let i = 0; i < previewUsed; i++) previewPool[i].visible = false;
        previewUsed = 0;
        for (let i = 0; i < lineUsed; i++) lineHighlightPool[i].visible = false;
        lineUsed = 0;
    }

    renderer.clearPreview = function () {
        if (!renderer.available) return;
        clearPreviewInternal();
        requestRender();
    };

    // ---- Геометрия / layout ----
    renderer.layout = function () {
        if (!renderer.available || !app) return;
        const cRect = containerEl.getBoundingClientRect();
        const bRect = boardEl.getBoundingClientRect();
        const w = Math.max(1, Math.round(bRect.width));
        const h = Math.max(1, Math.round(bRect.height));

        app.renderer.resize(w, h);

        const view = app.view;
        view.style.left = (bRect.left - cRect.left) + 'px';
        view.style.top = (bRect.top - cRect.top) + 'px';
        view.style.width = w + 'px';
        view.style.height = h + 'px';

        cellPx = w / BOARD; // gap доски = 0
        stepPx = cellPx;
        renderer.cellSize = cellPx;

        // Перепозиционируем видимые блоки (превью/подсветка транзиентны).
        for (let r = 0; r < BOARD; r++) {
            for (let c = 0; c < BOARD; c++) {
                const sp = blockSprites[idx(r, c)];
                if (sp.visible) placeBlock(sp, r, c);
            }
        }
        clearPreviewInternal();
        requestRender();
    };

    // ---- Lifecycle ----
    renderer.start = function () {
        if (!renderer.available) return;
        let pending = false;
        for (let i = 0; i < tweens.length; i++) { if (!tweens[i].done) { pending = true; break; } }
        if (pending) ensureTicker();
        else requestRender();
    };

    renderer.stop = function () {
        stopTicker();
    };

    // ---- Потеря/восстановление WebGL-контекста ----
    function handleContextLost(e) {
        e.preventDefault();
        stopTicker();
        renderer.available = false;
        if (app && app.view) app.view.style.visibility = 'hidden';
        if (onContextLost) { try { onContextLost(); } catch (err) { } }
    }

    function handleContextRestored() {
        // Pixi v7 сам перезаливает GL-объекты. Возвращаем канвас и перерисовываем сцену
        // из актуальной board-модели.
        if (!app) return;
        renderer.available = true;
        if (app.view) app.view.style.visibility = '';
        for (let i = 0; i < renderedColor.length; i++) renderedColor[i] = null;
        blasting.clear();
        renderer.syncBoard();
        if (onContextRestored) { try { onContextRestored(); } catch (err) { } }
        requestRender();
    }

    function teardown() {
        try {
            if (app) {
                if (app.view && app.view.parentNode) app.view.parentNode.removeChild(app.view);
                app.destroy(true, { children: true });
            }
        } catch (e) { /* ignore */ }
        app = null;
        blockSprites.length = 0;
        renderedColor.length = 0;
        previewPool.length = 0;
        lineHighlightPool.length = 0;
        tweens.length = 0;
        blasting.clear();
    }

    // ---- init ----
    renderer.init = function (opts) {
        opts = opts || {};
        boardEl = opts.boardEl || null;
        containerEl = opts.boardContainer || null;
        BOARD = opts.boardSize || 8;
        getColorAt = typeof opts.getColorAt === 'function' ? opts.getColorAt : getColorAt;
        blockTextureUrls = opts.blockTextures || {};
        lowPerf = !!opts.lowPerf;
        onContextLost = opts.onContextLost || null;
        onContextRestored = opts.onContextRestored || null;
        const deviceMemory = opts.deviceMemory || 8;

        if (!PIXI || !hasWebGL() || !boardEl || !containerEl) {
            renderer.available = false;
            renderer.ready = Promise.resolve(false);
            return renderer.ready;
        }

        const resolution = (lowPerf || deviceMemory <= 4)
            ? 1
            : Math.min(window.devicePixelRatio || 1, 2);

        renderer.ready = (async function () {
            try {
                app = new PIXI.Application({
                    backgroundAlpha: 0,
                    antialias: !lowPerf,
                    autoDensity: true,
                    resolution: resolution,
                    powerPreference: 'high-performance',
                    width: 64,
                    height: 64
                });

                const view = app.view;
                view.className = 'pixi-board-canvas';
                view.style.position = 'absolute';
                view.style.pointerEvents = 'none';
                view.style.zIndex = '3';
                view.style.left = '0px';
                view.style.top = '0px';
                try {
                    const br = window.getComputedStyle(boardEl).borderRadius;
                    if (br) view.style.borderRadius = br;
                } catch (e) { }
                containerEl.appendChild(view);

                view.addEventListener('webglcontextlost', handleContextLost, false);
                view.addEventListener('webglcontextrestored', handleContextRestored, false);

                const urls = [];
                for (const token in blockTextureUrls) {
                    if (Object.prototype.hasOwnProperty.call(blockTextureUrls, token)) {
                        urls.push(blockTextureUrls[token]);
                    }
                }
                await withTimeout(PIXI.Assets.load(urls), 5000);

                for (const token in blockTextureUrls) {
                    if (Object.prototype.hasOwnProperty.call(blockTextureUrls, token)) {
                        textures[token] = PIXI.Texture.from(blockTextureUrls[token]);
                    }
                }
                bakeYellow(opts);

                buildScene();
                renderer.available = true;
                app.ticker.add(tickerTick);
                app.ticker.stop();
                tickerRunning = false;

                renderer.layout();
                return true;
            } catch (e) {
                console.warn('PixiRenderer init failed, falling back to DOM:', e);
                teardown();
                renderer.available = false;
                return false;
            }
        })();

        return renderer.ready;
    };

    // Жёлтый блок в DOM рисуется с CSS hue-rotate(-24deg) saturate(1.15) brightness(1.08)
    // поверх своей текстуры. Запекаем эквивалент один раз в RenderTexture, чтобы не держать
    // фильтр в кадре. Если что-то пойдёт не так — оставляем текстуру как есть.
    function bakeYellow(opts) {
        try {
            const yellowToken = opts.yellowToken;
            const ColorMatrix = PIXI.ColorMatrixFilter || (PIXI.filters && PIXI.filters.ColorMatrixFilter);
            if (!yellowToken || !textures[yellowToken] || !ColorMatrix) return;
            const baseTex = textures[yellowToken];
            const tmp = new PIXI.Sprite(baseTex);
            const cm = new ColorMatrix();
            cm.brightness(1.08, false);
            cm.saturate(0.15, true);
            cm.hue(-24, true);
            tmp.filters = [cm];
            const rt = PIXI.RenderTexture.create({
                width: baseTex.width,
                height: baseTex.height,
                resolution: baseTex.baseTexture ? baseTex.baseTexture.resolution : 1
            });
            app.renderer.render(tmp, { renderTexture: rt });
            textures[yellowToken] = rt;
            tmp.destroy();
        } catch (e) {
            // оставляем исходную текстуру
        }
    }
})();
