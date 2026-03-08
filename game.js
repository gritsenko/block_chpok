// --- AUDIO MANAGER (Web Audio API) ---
class AudioManager {
    constructor() {
        this.audioContext = null;
        this.buffers = {};
        this.isInitialized = false;
        // ОПТИМИЗАЦИЯ: рекомендация - объединить mp3 в Audio Sprite для уменьшения HTTP-запросов
        this.soundConfigs = {
            pick: { file: 'pick.mp3', volume: 0.4 },
            click: { file: 'click.mp3', volume: 0.3 },
            pop: { file: 'pop1.mp3', volume: 0.5 },
            line: { file: 'line.mp3', volume: 0.6 },
            hardPop: { file: 'hard_pop.mp3', volume: 0.7 }
        };
    }

    async init() {
        if (this.isInitialized) return;

        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const loadPromises = Object.entries(this.soundConfigs).map(([key, config]) => {
                return this.loadSound(key, config.file);
            });

            await Promise.all(loadPromises);
            this.isInitialized = true;
        } catch (e) {
            console.warn('Audio initialization failed:', e);
        }
    }

    async loadSound(name, fileName) {
        try {
            const response = await fetch(fileName);
            const arrayBuffer = await response.arrayBuffer();
            this.buffers[name] = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.warn(`Failed to load sound ${name}:`, e);
        }
    }

    play(soundName) {
        if (!this.isInitialized) {
            this.init().catch(() => {});
            return;
        }

        if (!this.buffers[soundName]) return;

        try {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            const buffer = this.buffers[soundName];
            const config = this.soundConfigs[soundName];
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();

            source.buffer = buffer;
            gainNode.gain.value = config.volume;

            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            source.start(0);
        } catch (e) {
            console.warn(`Failed to play sound ${soundName}:`, e);
        }
    }
}

const audioManager = new AudioManager();

// --- HAPTIC FEEDBACK SYSTEM ---
const supportsHaptics = typeof window !== 'undefined'
    && (window.matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod/.test(navigator.userAgent));

const hapticFallbackState = {
    labelEl: null,
    inputEl: null,
    lastX: 0,
    lastY: 0,
    hideTimeoutId: null
};

function ensureHapticFallbackElement() {
    if (!supportsHaptics || typeof document === 'undefined') return null;
    if (hapticFallbackState.labelEl && hapticFallbackState.inputEl) {
        return hapticFallbackState;
    }

    const labelEl = document.createElement('label');
    labelEl.ariaHidden = 'true';
    labelEl.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;opacity:0.015;pointer-events:auto;z-index:2147483647;transform:translate3d(-100px,-100px,0);margin:0;padding:0;border:0;background:transparent;overflow:hidden;touch-action:none;';

    const inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    inputEl.setAttribute('switch', '');
    inputEl.tabIndex = -1;
    inputEl.style.cssText = 'width:100%;height:100%;margin:0;opacity:0.01;pointer-events:none;';

    labelEl.appendChild(inputEl);
    document.body.appendChild(labelEl);

    hapticFallbackState.labelEl = labelEl;
    hapticFallbackState.inputEl = inputEl;
    return hapticFallbackState;
}

function moveHapticFallback(x, y) {
    const state = ensureHapticFallbackElement();
    if (!state || !Number.isFinite(x) || !Number.isFinite(y)) return;

    state.lastX = x;
    state.lastY = y;

    const left = Math.round(x - 11);
    const top = Math.round(y - 11);
    state.labelEl.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function hideHapticFallback() {
    const state = ensureHapticFallbackElement();
    if (!state) return;
    state.labelEl.style.transform = 'translate3d(-100px,-100px,0)';
}

function _haptic(options = null) {
    try {
        if (navigator.vibrate) {
            navigator.vibrate(50);
            return;
        }

        if (!supportsHaptics) return;

        const state = ensureHapticFallbackElement();
        if (!state) return;

        if (options && Number.isFinite(options.x) && Number.isFinite(options.y)) {
            moveHapticFallback(options.x, options.y);
        } else if (Number.isFinite(state.lastX) && Number.isFinite(state.lastY)) {
            moveHapticFallback(state.lastX, state.lastY);
        }

        state.labelEl.click();
    } catch {
        // do nothing
    }
}

_haptic.confirm = (options = null) => {
    if (navigator.vibrate) {
        navigator.vibrate([50, 70, 50]);
        return;
    }

    _haptic(options);
    setTimeout(() => _haptic(options), 120);
};

_haptic.error = () => {
    if (navigator.vibrate) {
        navigator.vibrate([50, 70, 50, 70, 50]);
        return;
    }

    _haptic();
    setTimeout(() => _haptic(), 120);
    setTimeout(() => _haptic(), 240);
};

_haptic.track = (x, y) => {
    if (navigator.vibrate || !supportsHaptics) return;

    if (hapticFallbackState.hideTimeoutId !== null) {
        clearTimeout(hapticFallbackState.hideTimeoutId);
        hapticFallbackState.hideTimeoutId = null;
    }

    moveHapticFallback(x, y);
};

_haptic.release = () => {
    if (navigator.vibrate || !supportsHaptics) return;

    if (hapticFallbackState.hideTimeoutId !== null) {
        clearTimeout(hapticFallbackState.hideTimeoutId);
    }

    hapticFallbackState.hideTimeoutId = setTimeout(() => {
        hideHapticFallback();
        hapticFallbackState.hideTimeoutId = null;
    }, 220);
};

const haptic = _haptic;

// --- НАСТРОЙКИ И ДАННЫЕ ---
const BOARD_SIZE = 8;
const BEST_SCORE_KEY = 'block-chpok-best-score';
const COLORS = {
    orange: 'var(--color-orange)',
    blue: 'var(--color-blue)',
    green: 'var(--color-green)',
    purple: 'var(--color-purple)',
    yellow: 'var(--color-yellow)',
    red: 'var(--color-red)'
};

const COLOR_CLASS_BY_TOKEN = {
    [COLORS.orange]: 'block-color-orange',
    [COLORS.blue]: 'block-color-blue',
    [COLORS.green]: 'block-color-green',
    [COLORS.purple]: 'block-color-purple',
    [COLORS.yellow]: 'block-color-yellow',
    [COLORS.red]: 'block-color-red'
};

// ОПТИМИЗАЦИЯ: палитра упрощена до базовых цветов (используется для частиц)
const BLOCK_PALETTES = {
    [COLORS.orange]: { base: '#f58220' },
    [COLORS.blue]: { base: '#35a0f0' },
    [COLORS.green]: { base: '#66cc33' },
    [COLORS.purple]: { base: '#b042ff' },
    [COLORS.yellow]: { base: '#ffcc00' },
    [COLORS.red]: { base: '#f03030' }
};

const SHAPES_DATA = [
    { matrix: [[1]], color: COLORS.yellow },
    { matrix: [[1, 1], [1, 1]], color: COLORS.blue },
    { matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], color: COLORS.red },
    { matrix: [[1, 1]], color: COLORS.green },
    { matrix: [[1], [1]], color: COLORS.green },
    { matrix: [[1, 1, 1]], color: COLORS.orange },
    { matrix: [[1], [1], [1]], color: COLORS.orange },
    { matrix: [[1, 1, 1, 1]], color: COLORS.blue },
    { matrix: [[1], [1], [1], [1]], color: COLORS.blue },
    { matrix: [[1, 1, 1, 1, 1]], color: COLORS.purple },
    { matrix: [[1], [1], [1], [1], [1]], color: COLORS.purple },
    { matrix: [[1, 0], [1, 1]], color: COLORS.orange },
    { matrix: [[0, 1], [1, 1]], color: COLORS.orange },
    { matrix: [[1, 1], [1, 0]], color: COLORS.orange },
    { matrix: [[1, 1], [0, 1]], color: COLORS.orange },
    { matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], color: COLORS.purple },
    { matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], color: COLORS.purple },
    { matrix: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], color: COLORS.purple },
    { matrix: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], color: COLORS.purple },
    { matrix: [[1, 1, 1], [0, 1, 0]], color: COLORS.green },
    { matrix: [[0, 1, 0], [1, 1, 1]], color: COLORS.green },
    { matrix: [[1, 0], [1, 1], [1, 0]], color: COLORS.green },
    { matrix: [[0, 1], [1, 1], [0, 1]], color: COLORS.green }
];

// --- СОСТОЯНИЕ ИГРЫ ---
let board = [];
let trayPieces = [null, null, null];
let score = 0;
let bestScore = 0;
let displayedScore = 0;
let scoreAnimationToken = 0;
let refillTimeoutIds = [];
let gameOverTimeoutId = null;
let isRefillingTray = false;
let lastPlacementCoords = null;
let comboStreak = 0;

const gameContainer = document.querySelector('.game-container');
const boardEl = document.getElementById('board');
const traySlots = [
    document.getElementById('slot-0'),
    document.getElementById('slot-1'),
    document.getElementById('slot-2')
];
const scoreEl = document.getElementById('score');
const bestScoreEl = document.getElementById('best-score');
const comboDisplay = document.getElementById('combo-display');
const gameOverScreen = document.getElementById('game-over');
const gameOverScoreEl = document.getElementById('game-over-score');
const gameOverBestEl = document.getElementById('game-over-best');

function playSound(soundName) {
    audioManager.play(soundName);
}

let dragElement = null;
let dragPieceIndex = -1;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragStartPointerX = 0;
let dragStartPointerY = 0;
let dragAnchorX = 0;
let dragAnchorY = 0;
let cellSize = 0;
let lastKnownCellSize = 0;
let gapSize = 3;
let isDragging = false;
let isAnimating = false;

const DRAG_GAIN_X = 1.35;
const DRAG_GAIN_Y = 1.55;
const DRAG_POPUP_LIFT_Y = 58;

// ОПТИМИЗАЦИЯ: переиспользуем объект координат и уменьшаем давление на GC
const currentCoords = { r: -1, c: -1 };

function cloneShape(shape) {
    if (!shape) return null;
    return {
        matrix: shape.matrix.map(row => row.slice()),
        color: shape.color
    };
}

function clearPendingRefill() {
    refillTimeoutIds.forEach(id => clearTimeout(id));
    refillTimeoutIds = [];
    isRefillingTray = false;
}

function clearPendingGameOver() {
    if (gameOverTimeoutId !== null) {
        clearTimeout(gameOverTimeoutId);
        gameOverTimeoutId = null;
    }
}

function loadBestScore() {
    try {
        const savedValue = window.localStorage.getItem(BEST_SCORE_KEY);
        const parsedValue = Number(savedValue);
        bestScore = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
    } catch (error) {
        bestScore = 0;
    }
    updateBestScoreDisplay();
}

function saveBestScore(nextBestScore) {
    bestScore = nextBestScore;
    try {
        window.localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
    } catch (error) {
        // ignore storage errors
    }
    updateBestScoreDisplay();
}

function updateBestScoreDisplay() {
    const formattedBestScore = bestScore.toLocaleString('en-US');
    bestScoreEl.textContent = formattedBestScore;
    gameOverBestEl.textContent = formattedBestScore;
}

function isThreeByThreeSquare(shape) {
    return Boolean(shape)
        && shape.matrix.length === 3
        && shape.matrix[0].length === 3
        && shape.matrix.every(row => row.every(cell => cell === 1));
}

function triggerCameraShake() {
    gameContainer.classList.remove('shake');
    void gameContainer.offsetWidth;
    gameContainer.classList.add('shake');
}

function finalizeBestScore() {
    if (score > bestScore) {
        saveBestScore(score);
    } else {
        updateBestScoreDisplay();
    }
}

function showGameOver() {
    finalizeBestScore();
    gameOverScoreEl.textContent = score.toLocaleString('en-US');
    haptic.error();
    gameOverScreen.classList.add('show');
}

function getBlockClass(colorStr) {
    return COLOR_CLASS_BY_TOKEN[colorStr] || 'block-color-purple';
}

function createBlockElement(colorStr) {
    const block = document.createElement('div');
    block.className = `block-item ${getBlockClass(colorStr)}`;
    return block;
}

function getCurrentCellSize() {
    const boardRect = boardEl.getBoundingClientRect();
    const boardStyles = window.getComputedStyle(boardEl);
    const parsedGap = parseFloat(boardStyles.columnGap || boardStyles.gap || '3');
    gapSize = Number.isFinite(parsedGap) ? parsedGap : 3;

    const firstCell = document.querySelector('.cell');
    const directCellSize = firstCell ? firstCell.getBoundingClientRect().width : 0;
    const fallbackCellSize = (boardRect.width - gapSize * (BOARD_SIZE - 1)) / BOARD_SIZE;

    const nextCellSize = [directCellSize, fallbackCellSize, lastKnownCellSize, cellSize, 32]
        .find(size => Number.isFinite(size) && size > 0);

    lastKnownCellSize = nextCellSize;
    return nextCellSize;
}

function initGame() {
    clearPendingRefill();
    clearPendingGameOver();
    if (dragElement) {
        dragElement.remove();
        dragElement = null;
    }
    gameContainer.classList.remove('shake');
    board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    trayPieces = [null, null, null];
    score = 0;
    displayedScore = 0;
    isAnimating = false;
    isDragging = false;
    dragPieceIndex = -1;
    comboStreak = 0;
    updateScore();
    gameOverScreen.classList.remove('show');
    comboDisplay.style.animation = 'none';
    comboDisplay.classList.add('fade-out');
    boardEl.innerHTML = '';
    renderBoard();
    fillTray();
}

function renderBoard() {
    if (boardEl.children.length === 0) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.id = `cell-${r}-${c}`;
                boardEl.appendChild(cell);
            }
        }
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.getElementById(`cell-${r}-${c}`);
            const currentColor = cell.dataset.color || null;
            const targetColor = board[r][c];

            const hasChild = cell.children.length > 0;
            const shouldHaveChild = targetColor !== null;
            const logicalStateMatch = currentColor === targetColor;
            const domStateMatch = hasChild === shouldHaveChild;

            if (!logicalStateMatch || !domStateMatch) {
                cell.innerHTML = '';
                if (targetColor) {
                    cell.appendChild(createBlockElement(targetColor));
                }
                cell.dataset.color = targetColor || '';
            }
        }
    }
}

function createShapeHTML(shape, withPop = true) {
    const rows = shape.matrix.length;
    const cols = shape.matrix[0].length;
    const colorClass = getBlockClass(shape.color);

    let html = `<div class="shape" style="grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr); width: 100%; height: 100%;">`;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (shape.matrix[r][c]) {
                const popClass = withPop ? '' : ' no-pop';
                html += `<div class="block" style="aspect-ratio: 1/1;"><div class="block-item ${colorClass}${popClass}"></div></div>`;
            } else {
                html += '<div class="block empty" style="aspect-ratio: 1/1;"></div>';
            }
        }
    }
    html += '</div>';
    return html;
}

function fillTray() {
    const emptyCount = trayPieces.filter(p => !p).length;

    if (emptyCount === 3) {
        clearPendingRefill();
        isRefillingTray = true;
        renderTray(true);

        const refillStartTimeoutId = setTimeout(() => {
            for (let i = 0; i < 3; i++) {
                const randomShape = cloneShape(SHAPES_DATA[Math.floor(Math.random() * SHAPES_DATA.length)]);

                const slotFillTimeoutId = setTimeout(() => {
                    trayPieces[i] = randomShape;
                    renderTray(false, new Set([i]));

                    playSound('click');

                    const slot = traySlots[i];
                    if (slot) {
                        const rect = slot.getBoundingClientRect();
                        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, randomShape.color, 42);
                    }

                    if (i === 2) {
                        isRefillingTray = false;
                        refillTimeoutIds = [];
                        checkGameOver();
                    }
                }, i * 150);
                refillTimeoutIds.push(slotFillTimeoutId);
            }
        }, 300);
        refillTimeoutIds.push(refillStartTimeoutId);
    } else {
        renderTray();
        checkGameOver();
    }
}

function renderTray(forceEmpty = false, popIndexes = null) {
    for (let i = 0; i < 3; i++) {
        const slot = traySlots[i];
        const piece = forceEmpty ? null : trayPieces[i];

        slot.innerHTML = '';
        slot.onpointerdown = null;

        if (piece) {
            const rows = piece.matrix.length;
            const cols = piece.matrix[0].length;
            const gap = 3;

            const slotW = slot.clientWidth || 100;
            const slotH = slot.clientHeight || 140;

            const paddingW = 24;
            const paddingH = 24;

            const maxW = slotW - paddingW;
            const maxH = slotH - paddingH;

            const maxCellW = (maxW - gap * (cols - 1)) / cols;
            const maxCellH = (maxH - gap * (rows - 1)) / rows;

            let trayCellSize = Math.min(maxCellW, maxCellH);
            trayCellSize = Math.min(Math.max(trayCellSize, 20), 38);

            const container = document.createElement('div');
            const shouldPop = popIndexes instanceof Set ? popIndexes.has(i) : false;
            container.innerHTML = createShapeHTML(piece, shouldPop);
            const shapeEl = container.firstElementChild;

            const w = cols * trayCellSize + (cols - 1) * gap;
            const h = rows * trayCellSize + (rows - 1) * gap;

            shapeEl.style.width = `${w}px`;
            shapeEl.style.height = `${h}px`;
            shapeEl.style.transform = 'none';

            slot.appendChild(shapeEl);
            slot.onpointerdown = e => startDrag(e, i);
        }
    }
}

function startDrag(e, index) {
    if (!trayPieces[index] || isDragging || isAnimating) return;

    e.preventDefault();

    const piece = trayPieces[index];
    cellSize = getCurrentCellSize();

    haptic.track(e.clientX, e.clientY);
    playSound('pick');
    haptic({ x: e.clientX, y: e.clientY });

    isDragging = true;
    dragPieceIndex = index;

    dragElement = document.createElement('div');
    dragElement.className = 'drag-clone';
    dragElement.innerHTML = createShapeHTML(piece, false);

    const shapeEl = dragElement.firstElementChild;
    shapeEl.style.width = `${piece.matrix[0].length * cellSize + (piece.matrix[0].length - 1) * gapSize}px`;
    shapeEl.style.height = `${piece.matrix.length * cellSize + (piece.matrix.length - 1) * gapSize}px`;

    // ОПТИМИЗАЦИЯ: фиксируем left/top один раз, далее двигаем только transform
    dragElement.style.left = '0px';
    dragElement.style.top = '0px';

    document.body.appendChild(dragElement);

    if (traySlots[index].firstElementChild) {
        traySlots[index].firstElementChild.style.opacity = '0';
    }

    const clientX = e.clientX;
    const clientY = e.clientY;

    dragOffsetX = shapeEl.offsetWidth / 2;
    dragOffsetY = shapeEl.offsetHeight / 2 + DRAG_POPUP_LIFT_Y;

    const slotRect = traySlots[index].getBoundingClientRect();
    dragAnchorX = slotRect.left + slotRect.width / 2;
    dragAnchorY = slotRect.top + slotRect.height / 2;
    dragStartPointerX = clientX;
    dragStartPointerY = clientY;

    // Фигура появляется над центром слота, а не под точкой касания
    moveDrag(dragAnchorX, dragAnchorY);

    addDragListeners();
}

function addDragListeners() {
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('blur', cancelDrag);
}

function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    haptic.track(e.clientX, e.clientY);

    const dx = (e.clientX - dragStartPointerX) * DRAG_GAIN_X;
    const dy = (e.clientY - dragStartPointerY) * DRAG_GAIN_Y;
    const virtualX = dragAnchorX + dx;
    const virtualY = dragAnchorY + dy;

    moveDrag(virtualX, virtualY);
    updatePreview();
}

function moveDrag(x, y) {
    if (!dragElement) return;
    // ОПТИМИЗАЦИЯ: GPU-ускорение через translate3d без reflow
    dragElement.style.transform = `translate3d(${x - dragOffsetX}px, ${y - dragOffsetY}px, 0)`;
}

function updatePreview() {
    clearPreview();
    const coords = getBoardCoordinates();
    if (coords && canPlace(trayPieces[dragPieceIndex], coords.r, coords.c)) {
        drawPreview(trayPieces[dragPieceIndex], coords.r, coords.c);
    }
}

function getBoardCoordinates() {
    if (!dragElement) return null;

    if (!Number.isFinite(cellSize) || cellSize <= 0) {
        cellSize = getCurrentCellSize();
    }

    const rect = dragElement.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();

    const relX = rect.left - boardRect.left;
    const relY = rect.top - boardRect.top;

    const c = Math.round(relX / (cellSize + gapSize));
    const r = Math.round(relY / (cellSize + gapSize));

    currentCoords.r = r;
    currentCoords.c = c;
    return currentCoords;
}

function clearPreview() {
    document.querySelectorAll('.cell.preview').forEach(el => el.classList.remove('preview'));
}

function drawPreview(shape, startR, startC) {
    for (let r = 0; r < shape.matrix.length; r++) {
        for (let c = 0; c < shape.matrix[0].length; c++) {
            if (shape.matrix[r][c]) {
                const cell = document.getElementById(`cell-${startR + r}-${startC + c}`);
                if (cell) cell.classList.add('preview');
            }
        }
    }
}

async function endDrag(e) {
    if (!isDragging) return;

    if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        haptic.track(e.clientX, e.clientY);
    }

    removeDragListeners();

    const coords = getBoardCoordinates();
    const piece = trayPieces[dragPieceIndex];
    const savedDragPieceIndex = dragPieceIndex;

    if (dragElement) {
        dragElement.remove();
        dragElement = null;
    }

    clearPreview();
    isDragging = false;
    dragPieceIndex = -1;

    if (coords && canPlace(piece, coords.r, coords.c)) {
        const blocksPlaced = placeShape(piece, coords.r, coords.c);
        trayPieces[savedDragPieceIndex] = null;

        haptic.confirm(e ? { x: e.clientX, y: e.clientY } : null);
        renderBoard();

        if (isThreeByThreeSquare(piece)) {
            triggerCameraShake();
            playSound('hardPop');
        }

        for (let r = 0; r < piece.matrix.length; r++) {
            for (let c = 0; c < piece.matrix[0].length; c++) {
                if (piece.matrix[r][c]) {
                    const cellR = coords.r + r;
                    const cellC = coords.c + c;
                    const cell = document.getElementById(`cell-${cellR}-${cellC}`);
                    if (cell) {
                        const rect = cell.getBoundingClientRect();
                        createLandingParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, piece.color);
                    }
                }
            }
        }

        traySlots[savedDragPieceIndex].innerHTML = '';
        await checkLines(blocksPlaced);
        renderTray();
        fillTray();
    } else {
        playSound('click');
        if (traySlots[savedDragPieceIndex].firstElementChild) {
            traySlots[savedDragPieceIndex].firstElementChild.style.opacity = '1';
        }
        traySlots[savedDragPieceIndex].style.opacity = '1';
    }

    haptic.release();
}

function removeDragListeners() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('blur', cancelDrag);
}

function cancelDrag() {
    if (!isDragging) return;

    const savedDragPieceIndex = dragPieceIndex;

    removeDragListeners();

    if (dragElement) {
        dragElement.remove();
        dragElement = null;
    }

    clearPreview();
    isDragging = false;
    dragPieceIndex = -1;

    if (savedDragPieceIndex >= 0 && traySlots[savedDragPieceIndex]?.firstElementChild) {
        traySlots[savedDragPieceIndex].firstElementChild.style.opacity = '1';
    }

    haptic.release();
}

function refreshLayoutMetrics() {
    cellSize = getCurrentCellSize();
}

function canPlace(shape, startR, startC) {
    for (let r = 0; r < shape.matrix.length; r++) {
        for (let c = 0; c < shape.matrix[0].length; c++) {
            if (shape.matrix[r][c]) {
                const boardR = startR + r;
                const boardC = startC + c;
                if (boardR < 0 || boardR >= BOARD_SIZE || boardC < 0 || boardC >= BOARD_SIZE) {
                    return false;
                }
                if (board[boardR][boardC] !== null) {
                    return false;
                }
            }
        }
    }
    return true;
}

function placeShape(shape, startR, startC) {
    let blocksPlaced = 0;
    for (let r = 0; r < shape.matrix.length; r++) {
        for (let c = 0; c < shape.matrix[0].length; c++) {
            if (shape.matrix[r][c]) {
                board[startR + r][startC + c] = shape.color;
                blocksPlaced++;
            }
        }
    }

    lastPlacementCoords = { r: startR, c: startC };
    playSound('pop');
    return blocksPlaced;
}

async function checkLines(blocksPlaced) {
    const rowsToClear = [];
    const colsToClear = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
        if (board[r].every(cell => cell !== null)) {
            rowsToClear.push(r);
        }
    }

    for (let c = 0; c < BOARD_SIZE; c++) {
        let colFull = true;
        for (let r = 0; r < BOARD_SIZE; r++) {
            if (board[r][c] === null) {
                colFull = false;
                break;
            }
        }
        if (colFull) colsToClear.push(c);
    }

    const linesToClear = [];
    rowsToClear.forEach(r => {
        const line = [];
        for (let c = 0; c < BOARD_SIZE; c++) line.push(`${r},${c}`);
        linesToClear.push(line);
    });
    colsToClear.forEach(c => {
        const line = [];
        for (let r = 0; r < BOARD_SIZE; r++) line.push(`${r},${c}`);
        linesToClear.push(line);
    });

    const totalLines = linesToClear.length;
    if (totalLines > 0) {
        comboStreak += 1;
    } else {
        comboStreak = 0;
    }

    const initialPoints = 10 * blocksPlaced * (totalLines + 1);
    score += initialPoints;
    updateScore();

    if (lastPlacementCoords) {
        const centerR = lastPlacementCoords.r;
        const centerC = lastPlacementCoords.c;
        const cell = document.getElementById(`cell-${centerR}-${centerC}`);
        if (cell) {
            const rect = cell.getBoundingClientRect();
            createScorePopup(rect.left + rect.width / 2, rect.top + rect.height / 2, `+${initialPoints}`);
        }
    }

    if (totalLines > 0) {
        isAnimating = true;

        try {
            renderBoard();

            const linePoints = totalLines * 100;
            const comboBonus = comboStreak > 1 ? (comboStreak - 1) * 50 : 0;
            const extraPoints = linePoints + comboBonus;

            score += extraPoints;
            updateScore();

            if (lastPlacementCoords) {
                const centerR = lastPlacementCoords.r;
                const centerC = lastPlacementCoords.c;
                const cell = document.getElementById(`cell-${centerR}-${centerC}`);
                if (cell) {
                    const rect = cell.getBoundingClientRect();
                    const praiseLines = ['Good!', 'Great!', 'Super!', 'Excellent!', 'Amazing!', 'Incredible!', 'Unbelievable!', 'Godlike!'];
                    const praise = praiseLines[Math.min(totalLines - 1, praiseLines.length - 1)];
                    createPraisePopup(praise);

                    if (totalLines > 1 && extraPoints > 0) {
                        createScorePopup(rect.left + rect.width / 2, rect.top + rect.height / 2 + rect.height, `+${extraPoints}`);
                    }
                }
            }

            const cellsToClear = new Set();
            if (comboStreak >= 2) {
                comboDisplay.textContent = `Combo x${comboStreak}`;
                comboDisplay.classList.remove('fade-out');
                comboDisplay.style.animation = 'none';
                void comboDisplay.offsetWidth;
                comboDisplay.style.animation = 'popCombo 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
            } else {
                comboDisplay.style.animation = 'none';
                comboDisplay.classList.add('fade-out');
            }

            playSound('line');

            for (let i = 0; i < totalLines; i++) {
                const currentLine = linesToClear[i];

                for (let j = 0; j < currentLine.length; j++) {
                    cellsToClear.add(currentLine[j]);
                }
            }

            const coordsArray = Array.from(cellsToClear).map(coord => {
                const [r, c] = coord.split(',').map(Number);
                return { coord, r, c };
            });

            if (lastPlacementCoords) {
                coordsArray.sort((a, b) => {
                    const distA = Math.abs(a.r - lastPlacementCoords.r) + Math.abs(a.c - lastPlacementCoords.c);
                    const distB = Math.abs(b.r - lastPlacementCoords.r) + Math.abs(b.c - lastPlacementCoords.c);
                    return distA - distB;
                });
            }

            await new Promise(resolve => setTimeout(resolve, 120));

            // Последовательное исчезновение: от ближайших к последней установке к дальним
            for (const item of coordsArray) {
                const [r, c] = item.coord.split(',').map(Number);
                const cell = document.getElementById(`cell-${r}-${c}`);
                if (cell) {
                    const colorStr = board[r][c];
                    const rect = cell.getBoundingClientRect();
                    createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, colorStr, 14);

                    const blockEl = cell.querySelector('.block-item');
                    if (blockEl) {
                        blockEl.classList.add('clearing');
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 45));

                board[r][c] = null;
                if (cell) {
                    const blockEl = cell.querySelector('.block-item');
                    if (blockEl) {
                        blockEl.style.opacity = '0';
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, 150));

            comboDisplay.style.animation = 'none';
            comboDisplay.classList.add('fade-out');

            renderBoard();
        } finally {
            isAnimating = false;
        }
    }

    lastPlacementCoords = null;
    return totalLines;
}

function createScorePopup(x, y, text) {
    const p = document.createElement('div');
    p.className = 'score-popup';
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
}

function createPraisePopup(text) {
    const p = document.createElement('div');
    p.className = 'praise-popup';
    p.textContent = text;
    p.style.left = `${window.innerWidth / 2}px`;
    p.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
}

function createParticles(x, y, colorStr, particleSize = 14) {
    const pal = BLOCK_PALETTES[colorStr] || BLOCK_PALETTES[COLORS.purple];
    const color = pal.base;
    // ОПТИМИЗАЦИЯ: меньше DOM-частиц на мобильных
    const particleCount = window.innerWidth <= 768 ? 4 : 7;

    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.backgroundColor = color;
        p.style.boxShadow = `0 0 6px ${color}`;
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.width = particleSize + 'px';
        p.style.height = particleSize + 'px';

        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 60 + 30;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        const rot = Math.random() * 360 + 'deg';

        p.style.setProperty('--tx', `calc(-50% + ${tx}px)`);
        p.style.setProperty('--ty', `calc(-50% + ${ty}px)`);
        p.style.setProperty('--rot', rot);

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 500);
    }
}

function createLandingParticles(x, y, colorStr) {
    const pal = BLOCK_PALETTES[colorStr] || BLOCK_PALETTES[COLORS.purple];
    const color = pal.base;

    // ОПТИМИЗАЦИЯ: уменьшено количество частиц приземления
    for (let i = 0; i < 2; i++) {
        const p = document.createElement('div');
        p.className = 'landing-particle';
        p.style.backgroundColor = color;
        p.style.opacity = '0.3';
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.width = '12px';
        p.style.height = '12px';

        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 40 + 10;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;

        p.style.setProperty('--tx', `calc(-50% + ${tx}px)`);
        p.style.setProperty('--ty', `calc(-50% + ${ty}px)`);

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 600);
    }
}

function updateScore() {
    scoreEl.textContent = score.toLocaleString('en-US');

    const mainScoreEl = document.getElementById('main-score');
    const duration = 1000;
    const startVal = displayedScore;
    const endVal = score;
    const startTime = performance.now();
    const currentAnimationToken = ++scoreAnimationToken;

    function animate(now) {
        if (currentAnimationToken !== scoreAnimationToken) {
            return;
        }

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress * (2 - progress);
        displayedScore = Math.floor(startVal + (endVal - startVal) * ease);
        mainScoreEl.textContent = displayedScore.toLocaleString('en-US');

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            displayedScore = endVal;
            mainScoreEl.textContent = displayedScore.toLocaleString('en-US');
        }
    }
    requestAnimationFrame(animate);
}

function checkGameOver() {
    clearPendingGameOver();

    for (let i = 0; i < 3; i++) {
        const piece = trayPieces[i];
        if (!piece) continue;

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (canPlace(piece, r, c)) {
                    return;
                }
            }
        }
    }

    gameOverTimeoutId = setTimeout(() => {
        showGameOver();
        gameOverTimeoutId = null;
    }, 500);
}

loadBestScore();

const splashPlayBtn = document.getElementById('splash-play-btn');
const splashOverlay = document.getElementById('splash-overlay');

function startGame() {
    splashOverlay.classList.add('hidden');
    audioManager.init();
    haptic.confirm();
    initGame();
}

splashPlayBtn.addEventListener('click', startGame);

document.addEventListener('pointermove', function (e) {
    if (isDragging) e.preventDefault();
}, { passive: false });

window.addEventListener('resize', refreshLayoutMetrics);
window.addEventListener('orientationchange', refreshLayoutMetrics);

window.initGame = initGame;
