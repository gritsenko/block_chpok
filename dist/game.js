// Блокируем выделение текста, контекстное меню и drag-and-drop изображений
// (требования платформы 1.6.1.8 / 1.6.2.7).
(function suppressNativeInteractionGestures() {
    const stop = function (event) {
        event.preventDefault();
    };
    window.addEventListener('contextmenu', stop, { passive: false });
    window.addEventListener('selectstart', stop, { passive: false });
    window.addEventListener('dragstart', stop, { passive: false });
    document.addEventListener('gesturestart', stop, { passive: false });
})();

// --- AUDIO MANAGER (Web Audio API) ---
class AudioManager {
    constructor() {
        this.audioContext = null;
        this.buffers = {};
        this.isInitialized = false;
        this.soundsEnabled = true;
        this.hasStartedSession = false;
        this.assetCacheName = 'block-chpok-audio-v1';
        this.soundConfigs = {
            pick: { file: 'pick.mp3', volume: 0.4 },
            click: { file: 'click.mp3', volume: 0.3 },
            pop: { file: 'pop1.mp3', volume: 0.5 },
            line: { file: 'line.mp3', volume: 0.6 },
            hardPop: { file: 'hard_pop.mp3', volume: 0.7 }
        };
    }

    async ensureAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        return this.audioContext;
    }

    async fetchAudioArrayBuffer(fileName, cacheName) {
        const assetUrl = new URL(fileName, window.location.href).href;

        if ('caches' in window) {
            const cache = await caches.open(cacheName);
            let response = await cache.match(assetUrl);

            if (!response) {
                response = await fetch(assetUrl, { cache: 'force-cache' });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                cache.put(assetUrl, response.clone()).catch(() => { });
            }

            return response.arrayBuffer();
        }

        const response = await fetch(assetUrl, { cache: 'force-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.arrayBuffer();
    }

    async init() {
        if (this.isInitialized || !this.soundsEnabled) return;

        try {
            await this.ensureAudioContext();

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
            const arrayBuffer = await this.fetchAudioArrayBuffer(fileName, this.assetCacheName);
            this.buffers[name] = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.warn(`Failed to load sound ${name}:`, e);
        }
    }

    async beginGameSession() {
        this.hasStartedSession = true;

        if (!this.soundsEnabled) {
            return;
        }

        try {
            await this.ensureAudioContext();
        } catch (e) {
            console.warn('Audio context startup failed:', e);
        }

        this.init().catch(() => { });
    }

    async suspend() {
        if (!this.audioContext || this.audioContext.state !== 'running') {
            return;
        }

        try {
            await this.audioContext.suspend();
        } catch (e) {
            console.warn('Failed to suspend audio context:', e);
        }
    }

    async resume() {
        if (!this.soundsEnabled || !this.hasStartedSession) {
            return;
        }

        try {
            await this.ensureAudioContext();
            this.init().catch(() => { });
        } catch (e) {
            console.warn('Failed to resume audio context:', e);
        }
    }

    setSoundEnabled(enabled) {
        this.soundsEnabled = enabled;

        if (!enabled) {
            this.suspend().catch(() => { });
            return;
        }

        if (this.hasStartedSession) {
            this.resume().catch(() => { });
        }
    }

    play(soundName) {
        if (!this.soundsEnabled) {
            return;
        }

        if (!this.isInitialized) {
            this.init().catch(() => { });
            return;
        }

        if (!this.buffers[soundName]) return;

        try {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(() => { });
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
const canUseMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
const isCoarsePointerDevice = canUseMatchMedia && window.matchMedia('(pointer: coarse)').matches;
const prefersReducedMotion = canUseMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reportedHardwareConcurrency = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : 8;
const reportedDeviceMemory = typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number'
    ? navigator.deviceMemory
    : 8;
const supportsHaptics = typeof window !== 'undefined'
    && (isCoarsePointerDevice || /iPhone|iPad|iPod/.test(navigator.userAgent));
const isLowPerfParticleMode = prefersReducedMotion
    || (isCoarsePointerDevice && (reportedHardwareConcurrency <= 6 || reportedDeviceMemory <= 4));

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

// --- ЧАСТИЧНАЯ СИСТЕМА ---
class ParticleSystem {
    constructor() {
        this.canvas = document.getElementById('particles-canvas');
        this.ctx = null;
        this.gameContainer = document.querySelector('.game-container');
        this.particles = [];
        this.landingParticles = [];
        this.animationFrameId = 0;
        this.lastFrameTime = 0;
        this.config = {
            particleCountScale: isLowPerfParticleMode ? 0.35 : (isCoarsePointerDevice ? 0.5 : 1),
            landingParticleCount: isLowPerfParticleMode ? 1 : 2,
            // shadowBlur на canvas — это размывающий проход на КАЖДУЮ частицу КАЖДЫЙ кадр.
            // На тач-устройствах (где и видны просадки при сбросе линий) отключаем полностью;
            // частицы остаются, пропадает только свечение.
            shadowBlur: (isLowPerfParticleMode || isCoarsePointerDevice) ? 0 : 6,
            maxParticles: isLowPerfParticleMode ? 56 : (isCoarsePointerDevice ? 84 : 144),
            maxLandingParticles: isLowPerfParticleMode ? 12 : (isCoarsePointerDevice ? 18 : 30)
        };

        if (this.canvas && this.gameContainer) {
            this.ctx = this.canvas.getContext('2d', {
                alpha: true
            });
            this.resizeCanvas();
            this.setCanvasVisibility(false);

            window.addEventListener('resize', () => this.resizeCanvas());
        }
    }

    resizeCanvas() {
        if (!this.canvas || !this.gameContainer) return;

        // Размеры подстраиваются под весь игровой контейнер
        const containerRect = this.gameContainer.getBoundingClientRect();
        const width = Math.max(1, Math.round(containerRect.width));
        const height = Math.max(1, Math.round(containerRect.height));

        // Устанавливаем размеры canvas
        this.canvas.width = width;
        this.canvas.height = height;

        // Позиционируем canvas внутри game-container
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
    }

    getRelativeCanvasPoint(x, y) {
        if (!this.canvas || !this.gameContainer) return null;

        const containerRect = this.gameContainer.getBoundingClientRect();
        const relX = x - containerRect.left;
        const relY = y - containerRect.top;

        if (relX < 0 || relX > this.canvas.width || relY < 0 || relY > this.canvas.height) {
            return null;
        }

        return { x: relX, y: relY };
    }

    trimParticleBuffer(list, maxCount) {
        const overflow = list.length - maxCount;

        if (overflow > 0) {
            list.splice(0, overflow);
        }
    }

    hasActiveParticles() {
        return this.particles.length > 0 || this.landingParticles.length > 0;
    }

    setCanvasVisibility(isVisible) {
        if (!this.canvas) return;

        this.canvas.style.display = isVisible ? 'block' : 'none';
        this.canvas.style.visibility = isVisible ? 'visible' : 'hidden';
        this.canvas.style.opacity = isVisible ? '1' : '0';
    }

    clearCanvas() {
        if (!this.ctx) return;

        const ctx = this.ctx;
        ctx.globalCompositeOperation = 'copy';
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.globalCompositeOperation = 'source-over';
    }

    ensureAnimation() {
        if (!this.ctx || this.animationFrameId) return;

        this.setCanvasVisibility(true);
        this.lastFrameTime = 0;
        this.animationFrameId = requestAnimationFrame(timestamp => this.animate(timestamp));
    }

    createParticles(x, y, colorStr, particleSize = 14, count = 7, particleType = 'explosion') {
        if (!this.ctx) return;

        const origin = this.getRelativeCanvasPoint(x, y);
        if (!origin) return;

        let color;
        if (particleType === 'tray') {
            // Для частиц в трее используем белый цвет
            color = '#ffffff';
        } else {
            const pal = BLOCK_PALETTES[colorStr] || BLOCK_PALETTES[COLORS.purple];
            color = pal.base;
        }

        // Адаптируем количество частиц под мобильные устройства
        const particleCount = Math.max(1, Math.round(count * this.config.particleCountScale));

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 60 + 30;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            const rot = Math.random() * 360;

            // Настройки для частиц в трее
            let adjustedSize = particleSize;
            let adjustedLife = 0.5;
            let adjustedTx = tx;
            let adjustedTy = ty;

            if (particleType === 'tray') {
                adjustedSize *= 0.7;  // 0.7x меньше
                adjustedLife *= 0.5;  // 0.5x жизни (быстрее исчезают)
                adjustedTx *= 2;      // 2x быстрее по X
                adjustedTy *= 2;      // 2x быстрее по Y
            }

            this.particles.push({
                x: origin.x,
                y: origin.y,
                color: color,
                size: adjustedSize,
                tx: adjustedTx,
                ty: adjustedTy,
                rot: rot,
                life: adjustedLife,
                startLife: adjustedLife,
                type: particleType
            });
        }

        this.trimParticleBuffer(this.particles, this.config.maxParticles);
        this.ensureAnimation();
    }

    createLandingParticles(x, y, colorStr, particleType = 'landing') {
        if (!this.ctx) return;

        const origin = this.getRelativeCanvasPoint(x, y);
        if (!origin) return;

        let color;
        if (particleType === 'tray') {
            // Для частиц в трее используем белый цвет
            color = '#ffffff';
        } else {
            const pal = BLOCK_PALETTES[colorStr] || BLOCK_PALETTES[COLORS.purple];
            color = pal.base;
        }

        // Уменьшенное количество частиц приземления
        for (let i = 0; i < this.config.landingParticleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 40 + 10;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;

            // Настройки для частиц в трее
            let adjustedSize = 12;
            let adjustedOpacity = 0.6;
            let adjustedLife = 0.6;
            let adjustedTx = tx;
            let adjustedTy = ty;

            if (particleType === 'tray') {
                adjustedSize *= 0.7;  // 0.7x меньше
                adjustedOpacity *= 0.5;  // 0.5x прозрачнее
                adjustedLife *= 0.5;  // 0.5x жизни (быстрее исчезают)
                adjustedTx *= 2;      // 2x быстрее по X
                adjustedTy *= 2;      // 2x быстрее по Y
            }

            this.landingParticles.push({
                x: origin.x,
                y: origin.y,
                color: color,
                size: adjustedSize,
                opacity: adjustedOpacity,
                tx: adjustedTx,
                ty: adjustedTy,
                life: adjustedLife,
                startLife: adjustedLife,
                type: particleType
            });
        }

        this.trimParticleBuffer(this.landingParticles, this.config.maxLandingParticles);
        this.ensureAnimation();
    }

    updateParticles(list, deltaSeconds) {
        let writeIndex = 0;

        for (let readIndex = 0; readIndex < list.length; readIndex++) {
            const particle = list[readIndex];
            particle.life -= deltaSeconds;

            if (particle.life > 0) {
                list[writeIndex] = particle;
                writeIndex += 1;
            }
        }

        list.length = writeIndex;
    }

    update(deltaSeconds) {
        this.updateParticles(this.particles, deltaSeconds);
        this.updateParticles(this.landingParticles, deltaSeconds);
    }

    render() {
        if (!this.ctx) return;
        const ctx = this.ctx;

        // Очищаем область для перерисовки
        this.clearCanvas();

        if (!this.hasActiveParticles()) {
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            this.setCanvasVisibility(false);
            return;
        }

        // Рисуем обычные частицы
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            const lifeRatio = particle.life / particle.startLife;
            const progress = 1 - lifeRatio;
            const currentSize = particle.size * (1 - progress);
            const currentOpacity = Math.min(1, lifeRatio);

            // Для частиц в трее устанавливаем пониженную прозрачность
            let effectiveOpacity = currentOpacity;
            if (particle.type === 'tray') {
                effectiveOpacity *= 0.5; // 0.5 прозрачнее
            }

            if (currentSize <= 0.35 || effectiveOpacity <= 0.01) {
                continue;
            }

            ctx.globalAlpha = effectiveOpacity;
            ctx.fillStyle = particle.color;

            // Для частиц в трее уменьшаем размытие тени
            if (this.config.shadowBlur > 0) {
                ctx.shadowColor = particle.color;
                if (particle.type === 'tray') {
                    ctx.shadowBlur = Math.max(1, this.config.shadowBlur * 0.5);
                } else {
                    ctx.shadowBlur = this.config.shadowBlur;
                }
            } else {
                ctx.shadowBlur = 0;
            }

            ctx.beginPath();
            ctx.arc(
                particle.x + particle.tx * progress,
                particle.y + particle.ty * progress,
                currentSize / 2,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }

        ctx.shadowBlur = 0;

        // Рисуем частицы приземления
        for (let i = 0; i < this.landingParticles.length; i++) {
            const particle = this.landingParticles[i];
            const lifeRatio = particle.life / particle.startLife;
            const progress = 1 - lifeRatio;
            const scale = 0.5 + progress * 1.5; // увеличивается от 0.5 до 2.0
            const currentSize = particle.size * scale;
            const currentOpacity = particle.opacity * (1 - progress);

            // Для частиц в трее устанавливаем пониженную прозрачность
            let effectiveOpacity = currentOpacity;
            if (particle.type === 'tray') {
                effectiveOpacity *= 0.5; // 0.5 прозрачнее
            }

            if (currentSize <= 0.35 || effectiveOpacity <= 0.01) {
                continue;
            }

            ctx.globalAlpha = effectiveOpacity;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(
                particle.x + particle.tx * progress,
                particle.y + particle.ty * progress,
                currentSize / 2,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    animate(timestamp) {
        const deltaSeconds = this.lastFrameTime
            ? Math.min(0.05, (timestamp - this.lastFrameTime) / 1000)
            : 1 / 60;

        this.lastFrameTime = timestamp;
        this.update(deltaSeconds);
        this.render();

        if (!this.hasActiveParticles()) {
            this.animationFrameId = 0;
            this.lastFrameTime = 0;
            this.setCanvasVisibility(false);
            return;
        }

        this.animationFrameId = requestAnimationFrame(nextTimestamp => this.animate(nextTimestamp));
    }
}

let particleSystem = null;
// Инициализируем систему частиц после полной загрузки страницы
if (document.readyState === 'complete') {
    particleSystem = new ParticleSystem();
} else {
    window.addEventListener('load', () => {
        particleSystem = new ParticleSystem();
    });
}

// --- НАСТРОЙКИ И ДАННЫЕ ---
const BOARD_SIZE = 8;
// Прогресс для портальной воронки: уровней в классике нет, поэтому роль ступеней играют
// пороги счёта — levelComplete это «насколько далеко дошёл игрок».
// Список намеренно короткий и статичный: число уникальных имён событий на проект
// ограничено на сервере, а динамические имена туда лучше не отправлять вообще.
const SCORE_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000];
const BEST_SCORE_KEY = 'block-chpok-best-score';
const SOUND_ENABLED_KEY = 'block-chpok-sound-enabled';
const LEGACY_MUSIC_ENABLED_KEY = 'block-chpok-music-enabled';
const DEBUG_LANGUAGE_KEY = 'block-chpok-debug-language';
const DEFAULT_LANGUAGE = 'en';
const LOGO_BY_LANGUAGE = {
    en: 'logo.png',
    ru: 'logo_ru.png'
};
const I18N = {
    en: {
        numberLocale: 'en-US',
        documentTitle: 'Block Chpok',
        ogDescription: 'A playful block puzzle game',
        play: 'Play',
        modeClassic: 'Classic',
        modeAdventure: 'Adventure',
        adventureSub: 'Levels & goals',
        leaderboardTitle: 'Leaderboard',
        backToMenu: 'Main menu',
        levelShort: 'Level',
        gameOverTitle: 'Game Over!',
        scoreLabel: 'Score:',
        scoreLabelShort: 'SCORE:',
        crystalsLabel: 'BEST SCORE:',
        bestLabel: 'Best:',
        restart: 'Play Again',
        settingsTitle: 'Settings',
        openSettings: 'Open settings',
        closeSettings: 'Close settings',
        soundLabel: 'Sounds',
        soundOn: 'On',
        soundOff: 'Off',
        comboLabel: 'Combo',
        splashLogoAlt: 'Block Chpok',
        headerLogoAlt: 'Block Chpok Logo',
        secondChanceTitle: 'No moves!',
        secondChanceText: 'Watch an ad to get a new set of shapes?',
        secondChanceAdBtn: 'Watch Ad',
        secondChanceSkipBtn: 'No thanks',
        praiseLines: ['Good!', 'Great!', 'Super!', 'Excellent!', 'Amazing!', 'Incredible!', 'Unbelievable!', 'Godlike!']
    },
    ru: {
        numberLocale: 'ru-RU',
        documentTitle: 'Block Chpok',
        ogDescription: 'Увлекательная головоломка с блоками',
        play: 'Играть',
        modeClassic: 'Классика',
        modeAdventure: 'Приключение',
        adventureSub: 'Уровни и цели',
        leaderboardTitle: 'Лидеры',
        backToMenu: 'В меню',
        levelShort: 'Уровень',
        gameOverTitle: 'Игра окончена!',
        scoreLabel: 'Счет:',
        scoreLabelShort: 'СЧЁТ:',
        crystalsLabel: 'ЛУЧШИЙ СЧЁТ:',
        bestLabel: 'Рекорд:',
        restart: 'Играть снова',
        settingsTitle: 'Настройки',
        openSettings: 'Открыть настройки',
        closeSettings: 'Закрыть настройки',
        soundLabel: 'Звуки',
        soundOn: 'Вкл',
        soundOff: 'Выкл',
        comboLabel: 'Комбо',
        splashLogoAlt: 'Block Chpok',
        headerLogoAlt: 'Логотип Block Chpok',
        secondChanceTitle: 'Нет ходов!',
        secondChanceText: 'Посмотреть рекламу и получить новые фигуры?',
        secondChanceAdBtn: 'Посмотреть',
        secondChanceSkipBtn: 'Нет, спасибо',
        praiseLines: ['Хорошо!', 'Отлично!', 'Супер!', 'Превосходно!', 'Потрясающе!', 'Невероятно!', 'Феноменально!', 'Легендарно!']
    }
};
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
    [COLORS.red]: { base: '#f03030' },
    // Псевдо-токены препятствий: цвета нужны только системе частиц,
    // текстур блоков у них нет (рисуются CSS-оверлеями).
    'obstacle-rock': { base: '#b9b2aa' },
    'obstacle-crate': { base: '#c98a4b' },
    'obstacle-bomb': { base: '#ff8a4a' },
    'obstacle-ice': { base: '#a9e6ff' },
    'obstacle-gem': { base: '#59e8ff' }
};

const OBSTACLE_PARTICLE_TOKENS = {
    rock: 'obstacle-rock',
    crate: 'obstacle-crate',
    bomb: 'obstacle-bomb',
    ice: 'obstacle-ice',
    gem: 'obstacle-gem'
};

// URL текстур блоков для PixiJS-рендера — те же PNG, что и в CSS-классах (.block-color-*).
const PIXI_BLOCK_TEXTURE_URLS = {
    [COLORS.orange]: 'assets/theme/block-orange-v2.png',
    [COLORS.blue]: 'assets/theme/block-blue-v2.png',
    [COLORS.green]: 'assets/theme/block-green-v2.png',
    [COLORS.purple]: 'assets/theme/block-purple-v2.png',
    [COLORS.yellow]: 'assets/theme/block-yellow-v2.png',
    [COLORS.red]: 'assets/theme/block-red-v2.png'
};

// --- ВЫБОР РЕНДЕРА (DOM | PixiJS) ---
// Pixi рисует ДИНАМИКУ игрового поля (блоки/превью/анимации) в WebGL-канвасе, который
// перекрывает только .board. DOM остаётся рабочим фолбэком и используется, если WebGL/PIXI
// недоступны, при потере GL-контекста, либо принудительно по флагу ?renderer=dom.
function resolveRendererPreference() {
    try {
        const q = new URLSearchParams(window.location.search).get('renderer');
        if (q === 'dom' || q === 'pixi') return q;
    } catch (e) { /* ignore */ }
    try {
        const stored = window.localStorage.getItem('renderer_pref');
        if (stored === 'dom' || stored === 'pixi') return stored;
    } catch (e) { /* ignore */ }
    // Дефолт по платформе: под РЕАЛЬНЫМ нативным шеллом держим DOM до валидации WebView.
    // Ответ нужен синхронно, здесь и сейчас, поэтому спрашиваем фасад, а не провайдера:
    // localhost-симулятор, веб и порталы -> Pixi по умолчанию.
    const nativeShell = !!(window.GamePlatform
        && typeof window.GamePlatform.isNativeShell === 'function'
        && window.GamePlatform.isNativeShell());
    if (nativeShell) return 'dom';
    return 'pixi';
}
const RENDERER_PREFERENCE = resolveRendererPreference();
function usePixi() {
    return RENDERER_PREFERENCE === 'pixi'
        && window.pixiRenderer
        && window.pixiRenderer.available === true;
}

const SHAPES_DATA = [
    // 3x3 figures (most complex)
    { matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], color: COLORS.red }, // 3x3 square
    { matrix: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], color: COLORS.purple }, // L-shape
    { matrix: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], color: COLORS.purple }, // L-shape reversed
    { matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], color: COLORS.purple }, // L-shape mirrored
    { matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], color: COLORS.purple }, // L-shape mirrored reversed
    { matrix: [[1, 1, 1], [0, 1, 0]], color: COLORS.green }, // T-shape
    { matrix: [[0, 1, 0], [1, 1, 1]], color: COLORS.green }, // T-shape rotated
    { matrix: [[1, 0], [1, 1], [1, 0]], color: COLORS.green }, // T-shape sideways
    { matrix: [[0, 1], [1, 1], [0, 1]], color: COLORS.green }, // T-shape sideways mirrored
    { matrix: [[1, 1, 1], [1, 1, 1]], color: COLORS.red }, // 2x3 rectangle

    // 2x2 figures
    { matrix: [[1, 1], [1, 1]], color: COLORS.blue }, // 2x2 square

    // 2x3 and 3x2 rectangles
    { matrix: [[1, 1], [1, 1], [1, 1]], color: COLORS.purple },  // 3x2 rectangle

    // Z-shaped figures (Tetris-like)
    { matrix: [[1, 1, 0], [0, 1, 1]], color: COLORS.orange }, // Z-shape
    { matrix: [[0, 1, 1], [1, 1, 0]], color: COLORS.orange }, // Z-shape mirrored
    { matrix: [[1, 0], [1, 1], [0, 1]], color: COLORS.red }, // Z-shape vertical
    { matrix: [[0, 1], [1, 1], [1, 0]], color: COLORS.red }, // Z-shape vertical mirrored

    // L-shaped figures
    { matrix: [[1, 0], [1, 1]], color: COLORS.orange }, // L-shape small
    { matrix: [[0, 1], [1, 1]], color: COLORS.orange }, // L-shape small mirrored
    { matrix: [[1, 1], [1, 0]], color: COLORS.orange }, // L-shape small mirrored2
    { matrix: [[1, 1], [0, 1]], color: COLORS.orange }, // L-shape small mirrored3

    // Diagonal figures
    { matrix: [[1, 0], [0, 1]], color: COLORS.yellow }, // diagonal 2 blocks

    // 1xN and Nx1 figures
    { matrix: [[1, 1, 1, 1, 1]], color: COLORS.purple }, // 1x5
    { matrix: [[1], [1], [1], [1], [1]], color: COLORS.purple }, // 5x1
    { matrix: [[1, 1, 1, 1]], color: COLORS.blue }, // 1x4
    { matrix: [[1], [1], [1], [1]], color: COLORS.blue }, // 4x1
    { matrix: [[1, 1, 1]], color: COLORS.orange }, // 1x3
    { matrix: [[1], [1], [1]], color: COLORS.orange }  // 3x1
];

// --- РЕЖИМЫ ИГРЫ ---
// 'endless'   — классика: бесконечная партия на рекорд (историческое поведение).
// 'adventure' — приключение: уровни с целями, лимитом ходов и препятствиями.
// Ядро (этот файл) ничего не знает про цели и прогресс: оно только отдаёт события
// в window.Adventure и выполняет команды из window.GameCore. Вся мета-логика
// приключения живёт в adventure.js, данные уровней — в levels.js.
const MODE_ENDLESS = 'endless';
const MODE_ADVENTURE = 'adventure';

// Слой препятствий поверх board. board[r][c] — цвет блока (или null), а
// obstacles[r][c] — { type, hp } / null. Слои независимы, поэтому старый
// код, который читает board, продолжает работать без изменений.
//
//   void  — дырка в доске: ставить нельзя, в сборке линии НЕ участвует.
//   rock  — камень: ставить нельзя, для линии считается заполненной, hp сбивается очисткой.
//   crate — ящик: механика камня + учитывается в цели 'crates'.
//   bomb  — бомба: механика камня + обратный отсчёт по ходам; 0 => проигрыш.
//   ice   — лёд: ячейка ПУСТАЯ и доступна для установки, тает при очистке линии.
//   gem   — кристалл внутри блока: собирается, когда блок сносит линией.
const OBSTACLE_BLOCKS_PLACEMENT = { void: true, rock: true, crate: true, bomb: true };
const OBSTACLE_FILLS_LINE = { rock: true, crate: true, bomb: true };

let gameMode = MODE_ENDLESS;
let obstacles = [];
let activeShapePool = SHAPES_DATA;
let pendingLevelSetup = null;
let isInputLocked = false;
let isHammerArmed = false;

function createEmptyObstacleGrid() {
    return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
}

function getObstacle(r, c) {
    const row = obstacles[r];
    return row ? (row[c] || null) : null;
}

function isAdventureMode() {
    return gameMode === MODE_ADVENTURE;
}

// Единая точка вызова хуков приключения. В классике и без adventure.js — no-op,
// поэтому обёртки на местах вызова не нужны.
function adventureHook(name, payload) {
    if (!isAdventureMode() || !window.Adventure) return undefined;
    const fn = window.Adventure[name];
    if (typeof fn !== 'function') return undefined;
    try {
        return fn(payload);
    } catch (error) {
        console.warn(`Adventure hook ${name} failed:`, error);
        return undefined;
    }
}

// --- СОСТОЯНИЕ ИГРЫ ---
let board = [];
let trayPieces = [null, null, null];
let score = 0;
let bestScore = 0;
let displayedScore = 0;
let scoreAnimationToken = 0;
let refillTimeoutIds = [];
let gameOverTimeoutId = null;
let gameOverRevealTimeoutId = null;
let isRefillingTray = false;
let lastPlacementCoords = null;
let comboStreak = 0;
const isLocalhost = typeof window !== 'undefined'
    && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
const isEmbeddedRuntime = typeof window !== 'undefined' && window.self !== window.top;
const isLocalDebugEnabled = isLocalhost && !isEmbeddedRuntime;

function readDebugLanguageOverride() {
    if (!isLocalDebugEnabled) return null;
    try {
        const raw = window.localStorage.getItem(DEBUG_LANGUAGE_KEY);
        return (raw && Object.prototype.hasOwnProperty.call(I18N, raw)) ? raw : null;
    } catch {
        return null;
    }
}


let currentLanguage = readDebugLanguageOverride()
    || ((window.GamePlatform && typeof window.GamePlatform.getLanguage === 'function')
        ? window.GamePlatform.getLanguage()
        : (typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANGUAGE));
let isSoundEnabled = readStoredBoolean(SOUND_ENABLED_KEY, readStoredBoolean(LEGACY_MUSIC_ENABLED_KEY, true));
let hasGameStarted = false;
let isGameOverSequenceActive = false;
let isGameplayPausedBySdk = false;
let isGameplayMarkedActive = false;
let hasBoundPlatformLifecycle = false;
let platformLifecycleInitPromise = null;
let languageReadyPromise = null;
let hasRequestedPlatformGameReady = false;
let isSplashPlayEnabled = false;
let hasUsedSecondChance = false;
let reachedMilestones = 0;
let bestComboStreak = 0;
let pendingRewardShapes = null;

// --- INTERSTITIAL (показ полноэкранной рекламы при рестарте) ---
// Реклама привязана к началу новой сессии, а не к отказу: экран Game Over служит
// психологическим буфером, и только при нажатии «Заново» решается вопрос о показе.
const INTERSTITIAL_EVERY_N_GAMES = 3;                 // показываем не чаще, чем каждый 3-й рестарт
const INTERSTITIAL_MIN_SESSION_MS = 30 * 1000;        // только после достаточно долгой партии
const INTERSTITIAL_MIN_INTERVAL_MS = 2 * 60 * 1000;   // и если рекламы не было пару минут
const INTERSTITIAL_FALLBACK_MS = 45000;               // страховка на случай зависшего провайдера
let gamesSinceInterstitial = 0;
let skipNextInterstitial = false;                     // выставляется после возрождения за rewarded
let lastInterstitialAtMs = 0;
let sessionStartedAtMs = 0;
let isInterstitialInFlight = false;
const SCORE_ANIMATION_DURATION_MS = isLowPerfParticleMode ? 520 : 1000;
const SCORE_POPUP_LIFETIME_MS = isLowPerfParticleMode ? 650 : 1000;
const PRAISE_POPUP_LIFETIME_MS = isLowPerfParticleMode ? 800 : 1200;
const GAME_OVER_REVEAL_DELAY_MS = isLowPerfParticleMode ? 600 : 850;

const gameContainer = document.querySelector('.game-container');
const boardEl = document.getElementById('board');
const traySlots = [
    document.getElementById('slot-0'),
    document.getElementById('slot-1'),
    document.getElementById('slot-2')
];
const scoreEl = document.getElementById('score');
const mainScoreEl = document.getElementById('main-score');
const bestScoreEl = document.getElementById('best-score');
const crystalCountEl = document.getElementById('crystal-count');
const scoreLabelEl = document.getElementById('score-label');
const crystalsLabelEl = document.getElementById('crystals-label');
const comboDisplay = document.getElementById('combo-display');
const gameOverScreen = document.getElementById('game-over');
const gameOverTitleEl = document.getElementById('game-over-title');
const gameOverScoreLabelEl = document.getElementById('game-over-score-label');
const gameOverScoreEl = document.getElementById('game-over-score');
const gameOverBestLabelEl = document.getElementById('game-over-best-label');
const gameOverBestEl = document.getElementById('game-over-best');
const restartBtn = document.getElementById('restart-btn');

const secondChanceModal = document.getElementById('second-chance-modal');
const secondChanceTitleEl = document.getElementById('second-chance-title');
const secondChanceTextEl = document.getElementById('second-chance-text');
const secondChanceShapesEl = document.getElementById('second-chance-shapes');
const secondChanceAdBtn = document.getElementById('second-chance-ad-btn');
const secondChanceSkipBtn = document.getElementById('second-chance-skip-btn');

const characterStateLayers = (() => {
    const map = {};
    document.querySelectorAll('.header-branch-banner-state').forEach(el => {
        const key = el.dataset.characterState;
        if (key) map[key] = el;
    });
    return map;
})();
let characterStateRevertTimeoutId = null;
let currentCharacterState = 'base';
let pendingComboAnimationFrameId = 0;
const CHARACTER_STATE_HOLD_MS = 500;

function setCharacterState(state) {
    if (!characterStateLayers[state]) state = 'base';
    if (characterStateRevertTimeoutId !== null) {
        clearTimeout(characterStateRevertTimeoutId);
        characterStateRevertTimeoutId = null;
    }
    if (currentCharacterState === state) {
        if (state === 'fire' || state === 'sad') {
            characterStateRevertTimeoutId = setTimeout(() => {
                characterStateRevertTimeoutId = null;
                setCharacterState('base');
            }, CHARACTER_STATE_HOLD_MS);
        }
        return;
    }
    Object.entries(characterStateLayers).forEach(([key, el]) => {
        if (key === state) el.classList.add('active');
        else el.classList.remove('active');
    });
    currentCharacterState = state;
    if (state === 'fire' || state === 'sad') {
        characterStateRevertTimeoutId = setTimeout(() => {
            characterStateRevertTimeoutId = null;
            setCharacterState('base');
        }, CHARACTER_STATE_HOLD_MS);
    }
}

function hideComboDisplay() {
    if (!comboDisplay) return;

    if (pendingComboAnimationFrameId !== 0) {
        cancelAnimationFrame(pendingComboAnimationFrameId);
        pendingComboAnimationFrameId = 0;
    }

    comboDisplay.classList.remove('combo-visible', 'combo-pop');
    comboDisplay.classList.add('fade-out');
}

function showComboDisplay(text) {
    if (!comboDisplay) return;

    comboDisplay.textContent = text;
    comboDisplay.classList.remove('fade-out', 'combo-pop');
    comboDisplay.classList.add('combo-visible');

    if (pendingComboAnimationFrameId !== 0) {
        cancelAnimationFrame(pendingComboAnimationFrameId);
    }

    pendingComboAnimationFrameId = requestAnimationFrame(() => {
        pendingComboAnimationFrameId = requestAnimationFrame(() => {
            comboDisplay.classList.add('combo-pop');
            pendingComboAnimationFrameId = 0;
        });
    });
}

const splashPlayBtn = document.getElementById('splash-play-btn');
const splashModesEl = document.getElementById('splash-modes');
const splashAdventureBtn = document.getElementById('splash-play-adventure');
const splashLeaderboardBtn = document.getElementById('splash-leaderboard-btn');
const splashAdventureSubEl = document.getElementById('splash-adventure-sub');
const splashClassicSubEl = document.getElementById('splash-classic-sub');
const splashOverlay = document.getElementById('splash-overlay');
const splashLogoEl = document.getElementById('splash-logo');
const headerLogoEl = document.getElementById('header-logo');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsTitleEl = document.getElementById('settings-title');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const menuBtn = document.getElementById('settings-menu-btn');
const settingsLeaderboardBtn = document.getElementById('settings-leaderboard-btn');
const musicToggle = document.getElementById('music-toggle');
const musicToggleLabelEl = document.getElementById('music-toggle-label');
const musicToggleStatusEl = document.getElementById('music-toggle-status');
const ogTitleMeta = document.querySelector('meta[property="og:title"]');
const ogDescriptionMeta = document.querySelector('meta[property="og:description"]');
const localizedLogoEls = [splashLogoEl, headerLogoEl];

if (document.body) {
    document.body.classList.toggle('low-perf-effects', isLowPerfParticleMode);
}

audioManager.setSoundEnabled(isSoundEnabled);

// --- PixiJS-рендер игрового поля ---
// Запускаем асинхронную инициализацию сразу при загрузке: к моменту тапа «Играть»
// текстуры уже загружены. board-модель читается через замыкание (getColorAt), поэтому
// переприсвоение board в initGame() корректно отслеживается.
function initPixiRenderer() {
    if (RENDERER_PREFERENCE !== 'pixi' || !window.pixiRenderer || typeof window.pixiRenderer.init !== 'function') {
        return;
    }
    const boardContainer = document.querySelector('.board-container');
    if (!boardContainer || !boardEl) return;

    window.pixiRenderer.init({
        boardContainer: boardContainer,
        boardEl: boardEl,
        boardSize: BOARD_SIZE,
        blockTextures: PIXI_BLOCK_TEXTURE_URLS,
        yellowToken: COLORS.yellow,
        getColorAt: (r, c) => (board[r] ? (board[r][c] || null) : null),
        lowPerf: isLowPerfParticleMode,
        deviceMemory: reportedDeviceMemory,
        onContextLost: handlePixiContextLost,
        onContextRestored: handlePixiContextRestored
    });
}

// Потеря GL-контекста: pixiRenderer уже выставил available=false -> usePixi() вернёт false.
// Перерисовываем доску и трей в DOM из актуального состояния (живой фолбэк).
function handlePixiContextLost() {
    try {
        renderBoard();
        renderTray();
    } catch (e) {
        console.warn('DOM fallback after WebGL context loss failed:', e);
    }
}

// Восстановление контекста: pixiRenderer сам пересобрал сцену и вернул available=true.
// renderBoard() в pixi-ветке уберёт возможные DOM-блоки (boardHasDomBlocks) и синхронизирует канвас.
function handlePixiContextRestored() {
    try {
        renderBoard();
        renderTray();
    } catch (e) {
        console.warn('Re-render after WebGL context restore failed:', e);
    }
}

initPixiRenderer();

function updateSplashPlayButtonPosition() {
    if (!splashModesEl || !boardEl) return;

    const boardRect = boardEl.getBoundingClientRect();
    if (boardRect.width <= 0 || boardRect.height <= 0) return;

    splashModesEl.style.left = `${boardRect.left + boardRect.width / 2}px`;
    splashModesEl.style.top = `${boardRect.top + boardRect.height / 2}px`;
}

function normalizeLanguage(lang) {
    if (typeof lang !== 'string') return DEFAULT_LANGUAGE;
    return lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function getMessages() {
    return I18N[currentLanguage] || I18N[DEFAULT_LANGUAGE];
}

function formatNumber(value) {
    const locale = getMessages().numberLocale;
    return Number.isFinite(value) ? value.toLocaleString(locale) : '0';
}

function readStoredBoolean(key, fallbackValue) {
    try {
        const rawValue = window.localStorage.getItem(key);
        if (rawValue === null) return fallbackValue;
        return rawValue !== '0' && rawValue !== 'false';
    } catch {
        return fallbackValue;
    }
}

function writeStoredBoolean(key, value) {
    try {
        window.localStorage.setItem(key, value ? '1' : '0');
    } catch {
        // ignore storage errors
    }
}

function applyLocalizedLogos(language) {
    const preferredLogo = LOGO_BY_LANGUAGE[language] || LOGO_BY_LANGUAGE[DEFAULT_LANGUAGE];
    const fallbackLogo = LOGO_BY_LANGUAGE[DEFAULT_LANGUAGE];

    localizedLogoEls.forEach(img => {
        if (!img) return;

        img.onerror = preferredLogo !== fallbackLogo ? () => {
            img.onerror = null;
            img.src = fallbackLogo;
        } : null;

        if (img.getAttribute('src') !== preferredLogo) {
            img.src = preferredLogo;
        }
    });
}

function syncSoundToggleUI() {
    const messages = getMessages();

    if (musicToggle) {
        musicToggle.checked = isSoundEnabled;
    }

    if (musicToggleStatusEl) {
        musicToggleStatusEl.textContent = isSoundEnabled ? messages.soundOn : messages.soundOff;
    }
}

function refreshVisibleScoreText() {
    scoreEl.textContent = formatNumber(score);
    if (mainScoreEl) mainScoreEl.textContent = formatNumber(displayedScore);
    gameOverScoreEl.textContent = formatNumber(score);
    updateBestScoreDisplay();
}

function applyTranslations(language) {
    currentLanguage = normalizeLanguage(language);
    const messages = getMessages();

    document.documentElement.lang = currentLanguage;
    document.title = messages.documentTitle;

    if (ogTitleMeta) {
        ogTitleMeta.setAttribute('content', messages.documentTitle);
    }

    if (ogDescriptionMeta) {
        ogDescriptionMeta.setAttribute('content', messages.ogDescription);
    }

    const classicTitleEl = document.getElementById('splash-classic-title');
    const adventureTitleEl = document.getElementById('splash-adventure-title');
    if (classicTitleEl) classicTitleEl.textContent = messages.modeClassic;
    if (adventureTitleEl) adventureTitleEl.textContent = messages.modeAdventure;
    if (splashLeaderboardBtn) splashLeaderboardBtn.textContent = messages.leaderboardTitle;
    if (menuBtn) menuBtn.textContent = messages.backToMenu;
    if (settingsLeaderboardBtn) settingsLeaderboardBtn.textContent = messages.leaderboardTitle;
    syncLeaderboardEntryPoints();
    refreshSplashSubtitles();

    gameOverTitleEl.textContent = messages.gameOverTitle;
    gameOverScoreLabelEl.textContent = messages.scoreLabel;
    gameOverBestLabelEl.textContent = messages.bestLabel;
    if (scoreLabelEl) scoreLabelEl.textContent = messages.scoreLabelShort;
    if (crystalsLabelEl) crystalsLabelEl.textContent = messages.crystalsLabel;
    restartBtn.textContent = messages.restart;
    settingsTitleEl.textContent = messages.settingsTitle;
    musicToggleLabelEl.textContent = messages.soundLabel;
    settingsBtn.setAttribute('aria-label', messages.openSettings);
    settingsCloseBtn.setAttribute('aria-label', messages.closeSettings);
    if (splashLogoEl) splashLogoEl.alt = messages.splashLogoAlt;
    if (headerLogoEl) headerLogoEl.alt = messages.headerLogoAlt;

    if (secondChanceTitleEl) secondChanceTitleEl.textContent = messages.secondChanceTitle;
    if (secondChanceTextEl) secondChanceTextEl.textContent = messages.secondChanceText;
    if (secondChanceAdBtn) secondChanceAdBtn.textContent = messages.secondChanceAdBtn;
    if (secondChanceSkipBtn) secondChanceSkipBtn.textContent = messages.secondChanceSkipBtn;

    applyLocalizedLogos(currentLanguage);
    syncSoundToggleUI();

    // Приключение и лидерборды держат собственные словари и перерисовывают открытые экраны.
    if (window.Adventure && typeof window.Adventure.applyLanguage === 'function') {
        window.Adventure.applyLanguage(currentLanguage);
    }
    if (window.GameLeaderboards && typeof window.GameLeaderboards.applyLanguage === 'function') {
        window.GameLeaderboards.applyLanguage(currentLanguage);
    }

    if (comboStreak >= 2) {
        comboDisplay.textContent = `${messages.comboLabel} x${comboStreak}`;
    }

    refreshVisibleScoreText();
}

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
let dragPointerType = 'mouse';
let cellSize = 0;
let lastKnownCellSize = 0;
let gapSize = 3;
let isDragging = false;
let isAnimating = false;

// Pixi-режим: показано ли сейчас превью на канвасе (для корректного снятия), и есть ли в
// DOM-ячейках блоки (на случай переключения pixi<->dom).
let pixiPreviewActive = false;
let boardHasDomBlocks = false;

const DRAG_GAIN_X = 1.35;
const DRAG_GAIN_Y = 1.55;
const DRAG_POPUP_LIFT_Y = 58;

// ОПТИМИЗАЦИЯ: переиспользуем объект координат и уменьшаем давление на GC
const currentCoords = { r: -1, c: -1 };

// ОПТИМИЗАЦИЯ драга: кэши и состояние превью между кадрами.
// Цель — не делать тяжёлую работу на каждый pointermove (rAF-троттлинг,
// кэш ссылок на ячейки и цвета, дифф превью вместо querySelectorAll).
let cellRefs = [];                       // cellRefs[r][c] -> элемент ячейки (кэш вместо getElementById)
let cachedBoardRect = null;              // boardEl.getBoundingClientRect(), кэшируется на старте драга
let dragVirtualX = 0;                    // последняя виртуальная позиция драга (из onDragMove)
let dragVirtualY = 0;
let previewRafId = 0;                     // запланированный rAF для updatePreview (0 = нет)
let lastPreviewR = NaN;                   // координаты ячейки прошлого апдейта превью (ранний выход)
let lastPreviewC = NaN;
let lastPreviewPieceIndex = -1;
const previewCells = new Set();           // ячейки с классом 'preview' (текущий кадр)
const lineHighlightCells = new Set();     // ячейки с классом 'line-highlight' (текущий кадр)
const shapeColorCache = new Map();        // shape.color -> разрешённый hex (резолвим один раз)

// Доступ к ячейке через кэш; на промахе — безопасный фолбэк на getElementById.
function getCell(r, c) {
    return (cellRefs[r] && cellRefs[r][c]) || document.getElementById(`cell-${r}-${c}`);
}

function canInteractWithGameplay() {
    return shouldGameplayBeActive();
}

function waitForGameplayResume() {
    if (!isGameplayPausedBySdk) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const check = () => {
            if (!isGameplayPausedBySdk) {
                resolve();
                return;
            }

            setTimeout(check, 50);
        };

        check();
    });
}

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

    if (gameOverRevealTimeoutId !== null) {
        clearTimeout(gameOverRevealTimeoutId);
        gameOverRevealTimeoutId = null;
    }

    isGameOverSequenceActive = false;
}

function shouldGameplayBeActive() {
    // Gameplay must only be active during real play — not while the splash/Play
    // button is still shown. The host's "gameplay is active" indicator otherwise
    // turns green before the player ever presses Play (platform requirement: the
    // gameplay-start signal fires on actual gameplay, not on the menu screen).
    return hasGameStarted
        && !settingsModal.classList.contains('show')
        && !gameOverScreen.classList.contains('show')
        && !secondChanceModal.classList.contains('show')
        && !isGameOverSequenceActive
        && !isGameplayPausedBySdk
        // Приключение блокирует ввод, пока открыты карта/итоги уровня.
        && !isInputLocked;
}

function syncGameplayState() {
    const shouldBeActive = shouldGameplayBeActive();

    if (!window.GamePlatform) {
        isGameplayMarkedActive = false;
        return;
    }

    if (shouldBeActive === isGameplayMarkedActive) {
        return;
    }

    // The facade reports whether a host actually took the call, so no separate
    // availability probe is needed: no host means the flag simply stays false.
    const accepted = shouldBeActive
        ? window.GamePlatform.startGameplay()
        : window.GamePlatform.stopGameplay();

    isGameplayMarkedActive = accepted ? shouldBeActive : false;
}

function handlePlatformPause() {
    isGameplayPausedBySdk = true;

    if (isDragging) {
        cancelDrag();
    }

    if (window.pixiRenderer && typeof window.pixiRenderer.stop === 'function') {
        window.pixiRenderer.stop();
    }

    audioManager.suspend().catch(() => { });
    syncGameplayState();
}

function handlePlatformResume() {
    isGameplayPausedBySdk = false;

    if (hasGameStarted) {
        audioManager.resume().catch(() => { });
    }

    if (usePixi() && typeof window.pixiRenderer.start === 'function') {
        window.pixiRenderer.start();
    }

    syncGameplayState();
}

async function initializePlatformLifecycle() {
    if (hasBoundPlatformLifecycle) {
        syncGameplayState();
        return;
    }

    if (platformLifecycleInitPromise) {
        return platformLifecycleInitPromise;
    }

    platformLifecycleInitPromise = (async () => {
        try {
            if (!window.GamePlatform) {
                return;
            }

            // The host SDK is loaded and initialised by platform.js — whenReady() covers
            // both, so there is nothing to init here and nothing to poll for.
            await window.GamePlatform.whenReady();

            hasBoundPlatformLifecycle = true;
            window.GamePlatform.onPause(handlePlatformPause);
            window.GamePlatform.onResume(handlePlatformResume);

            if (window.GamePlatform.isPaused()) {
                handlePlatformPause();
            } else {
                syncGameplayState();
            }
        } catch (error) {
            console.warn('Failed to initialize platform lifecycle:', error);
        } finally {
            platformLifecycleInitPromise = null;
        }
    })();

    return platformLifecycleInitPromise;
}

async function notifyGameReadyForSplash() {
    // Intentionally NOT gated on isSplashPlayEnabled: the "game loaded" signal must be
    // sent while Play is still disabled, so the host sees it before the game is playable
    // (platform requirement 1.19). See prepareSplashPlay for the ordering.
    if (hasRequestedPlatformGameReady || hasGameStarted || !splashOverlay) {
        return;
    }

    hasRequestedPlatformGameReady = true;

    if (!window.GamePlatform) {
        return;
    }

    try {
        // Send once eagerly — a host that is already up accepts it right away and the
        // facade replays an early request after its own init if it is not.
        if (window.GamePlatform.gameReady()) {
            return;
        }

        await window.GamePlatform.whenReady();
        window.GamePlatform.gameReady();
    } catch (error) {
        console.warn('Failed to signal game-ready at splash:', error);
    }
}

function setSplashPlayEnabled(enabled) {
    isSplashPlayEnabled = !!enabled;

    if (splashModesEl) {
        splashModesEl.style.display = isSplashPlayEnabled ? '' : 'none';
        splashModesEl.setAttribute('aria-hidden', isSplashPlayEnabled ? 'false' : 'true');
    }

    [splashPlayBtn, splashAdventureBtn, splashLeaderboardBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = !isSplashPlayEnabled;
    });

    if (isSplashPlayEnabled) {
        refreshSplashSubtitles();
        updateSplashPlayButtonPosition();
    }
}

// Есть ли вообще куда вести игрока по кнопке рейтинга. В сборке без лидербордов фасад
// отвечает false и модалки не существует — значит и входов в неё быть не должно, иначе
// игрок жмёт кнопку, которая ничего не делает.
function canShowLeaderboard() {
    return !!(window.GameLeaderboards
        && typeof window.GameLeaderboards.isAvailable === 'function'
        && window.GameLeaderboards.isAvailable()
        && typeof window.GameLeaderboards.openUi === 'function');
}

// Доступность может появиться позже, когда хост доинициализируется, поэтому пересчёт
// висит на applyTranslations (её дёргает и whenReady) и на открытии настроек.
function syncLeaderboardEntryPoints() {
    const available = canShowLeaderboard();

    if (splashLeaderboardBtn) {
        splashLeaderboardBtn.hidden = !available;
    }

    if (settingsLeaderboardBtn) {
        settingsLeaderboardBtn.hidden = !available;
    }

    if (window.Adventure && typeof window.Adventure.syncLeaderboardButton === 'function') {
        window.Adventure.syncLeaderboardButton(available);
    }
}

// Подписи на кнопках режимов: рекорд классики и текущий прогресс приключения.
function refreshSplashSubtitles() {
    const messages = getMessages();

    if (splashClassicSubEl) {
        splashClassicSubEl.textContent = `${messages.bestLabel} ${formatNumber(bestScore)}`;
    }

    const summary = (window.Adventure && typeof window.Adventure.getProgressSummary === 'function')
        ? window.Adventure.getProgressSummary()
        : null;

    // Нет levels.js/adventure.js — кнопки режима быть не должно, иначе игрок
    // ткнёт в неё и попадёт в классику без объяснений.
    if (splashAdventureBtn) {
        splashAdventureBtn.hidden = !summary;
    }

    if (splashAdventureSubEl) {
        splashAdventureSubEl.textContent = summary
            ? `${messages.levelShort} ${summary.currentLevel} · ★ ${summary.totalStars}`
            : messages.adventureSub;
    }

    syncLeaderboardEntryPoints();
}

function setInputLocked(locked) {
    isInputLocked = !!locked;
    if (isInputLocked && isDragging) {
        cancelDrag();
    }
    syncGameplayState();
}

async function prepareSplashPlay() {
    // Order matters and enforces two platform requirements:
    //   1. Keep Play hidden until the SDK language is applied, so the whole UI appears
    //      in the correct language from the first frame (requirement 2.14).
    //   2. Signal "game loaded" BEFORE enabling Play, so the player can never start the
    //      game before the host has seen it (requirement 1.19). The splash start handler
    //      is gated on isSplashPlayEnabled, so a disabled button = not playable.
    setSplashPlayEnabled(false);

    try {
        await whenLanguageReady();
        // Tell the platform the game is fully loaded BEFORE making Play interactive.
        await notifyGameReadyForSplash();
    } catch (error) {
        console.warn('Failed to prepare splash Play button:', error);
    } finally {
        // Always reveal Play eventually, even if the SDK errored — never leave the
        // game permanently unplayable.
        setSplashPlayEnabled(true);
    }
}

function setSoundPreference(enabled) {
    isSoundEnabled = enabled;
    writeStoredBoolean(SOUND_ENABLED_KEY, enabled);
    syncSoundToggleUI();
    audioManager.setSoundEnabled(enabled);
}

function openSettingsModal() {
    settingsModal.classList.add('show');
    settingsModal.setAttribute('aria-hidden', 'false');
    syncSoundToggleUI();
    syncLeaderboardEntryPoints();
    syncGameplayState();
}

function closeSettingsModal() {
    settingsModal.classList.remove('show');
    settingsModal.setAttribute('aria-hidden', 'true');
    syncGameplayState();
}

async function initializeLanguage() {
    const debugOverride = readDebugLanguageOverride();
    if (debugOverride) {
        applyTranslations(debugOverride);
        return;
    }

    // Show something immediately (browser language) while the host SDK loads. Where a
    // platform loader is involved this stays hidden behind it until the game-ready signal
    // fires, so the user never sees the pre-SDK language.
    const initialLang = typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANGUAGE;
    applyTranslations(initialLang);

    if (!window.GamePlatform) {
        return;
    }

    // The host SDK is loaded and initialised by platform.js — wait for that, then switch
    // to the language it reports (requirement 2.14: auto-detect via SDK).
    try {
        await window.GamePlatform.whenReady();
        applyTranslations(window.GamePlatform.getLanguage());
    } catch (error) {
        console.warn('Failed to resolve platform language:', error);
    }
}

// Single shared startup so the splash gate and the bootstrap await the same language
// resolution instead of racing two independent SDK reads.
function whenLanguageReady() {
    if (!languageReadyPromise) {
        languageReadyPromise = initializeLanguage().catch(error => {
            console.warn('Language initialization failed:', error);
        });
    }
    return languageReadyPromise;
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

    // Личная статистика игрока идёт в облачный стор хоста, а рейтинг — через фасад
    // GameLeaderboards. Оба тихо ничего не делают там, где хост их не предоставляет.
    if (window.GamePlatform) {
        void window.GamePlatform.saveBestScore(bestScore);
    }

    if (window.GameLeaderboards) {
        window.GameLeaderboards.submit('endless', bestScore);
    }
}

function updateBestScoreDisplay() {
    // В приключении счёт партии не является рекордом классики — показываем только bestScore.
    const formattedBestScore = formatNumber(isAdventureMode() ? bestScore : Math.max(bestScore, score));
    if (bestScoreEl) {
        bestScoreEl.textContent = formattedBestScore;
    }
    if (crystalCountEl) {
        crystalCountEl.textContent = formattedBestScore;
    }
    gameOverBestEl.textContent = formattedBestScore;
}

function isThreeByThreeSquare(shape) {
    return Boolean(shape)
        && shape.matrix.length === 3
        && shape.matrix[0].length === 3
        && shape.matrix.every(row => row.every(cell => cell === 1));
}

function finalizeBestScore() {
    // Рекорд — метрика классики; очки уровня приключения в него не попадают.
    if (isAdventureMode()) {
        updateBestScoreDisplay();
        return;
    }

    if (score > bestScore) {
        saveBestScore(score);
    } else {
        updateBestScoreDisplay();
    }
}

function revealGameOverScreen() {
    gameOverScreen.classList.add('show');
    isGameOverSequenceActive = false;
    syncGameplayState();

    // Единственное место, где партия действительно заканчивается — сюда приходят и
    // обычный game over, и отказ от второго шанса.
    trackEvent('game_over', {
        score: score,
        best: bestScore,
        combo: bestComboStreak,
        second_chance: hasUsedSecondChance ? 1 : 0,
    });

    // Событие, которого требует сам хост: у классики «уровень» один — вся партия.
    // Воронку вех счёта несёт reportScoreMilestones через GameAds, это другой канал.
    if (window.GamePlatform) {
        window.GamePlatform.reportEvent('level_complete', { level: 1 });
    }
}

function randomPoolShape() {
    const pool = activeShapePool.length > 0 ? activeShapePool : SHAPES_DATA;
    return cloneShape(pool[Math.floor(Math.random() * pool.length)]);
}

function generateRewardShapes() {
    const newShapes = [];
    newShapes.push({ matrix: [[1]], color: COLORS.yellow }); // Одиночный квадратик

    const possibleShapes = getAllPossibleShapes();
    for (let i = 0; i < 2; i++) {
        if (possibleShapes.length > i) {
            newShapes.push(cloneShape(activeShapePool[possibleShapes[i]]));
        } else {
            newShapes.push(randomPoolShape());
        }
    }

    // Перемешиваем чтобы квадратик не всегда был первым
    newShapes.sort(() => Math.random() - 0.5);
    return newShapes;
}

function renderRewardShapes(shapes) {
    if (!secondChanceShapesEl) return;
    secondChanceShapesEl.innerHTML = '';

    shapes.forEach(piece => {
        const slot = document.createElement('div');
        slot.className = 'reward-shape-slot';
        // Слот добавляется в DOM ДО расчётов: размер ячейки считается от его реальной ширины.
        // Модалка здесь ещё visibility:hidden, но уже разложена, так что метрики настоящие.
        secondChanceShapesEl.appendChild(slot);

        const rows = piece.matrix.length;
        const cols = piece.matrix[0].length;
        const gap = 2;
        const padding = 6;

        // Размер ячейки ВЫЧИСЛЯЕТСЯ под слот, а не задан константой. Раньше здесь стояли
        // фиксированные 16px: полоска 1x5 или 5x1 рендерилась 88px шириной в слоте 60px,
        // вылезала наружу и накрывала кнопку «Посмотреть». Воспроизводилось не всегда —
        // только когда в награду попадала длинная фигура, а на забитом поле
        // getAllPossibleShapes() оставляет в основном полоски.
        const inner = Math.max(16, (slot.clientWidth || 60) - padding * 2);
        const trayCellSize = Math.max(4, Math.floor(Math.min(
            (inner - (cols - 1) * gap) / cols,
            (inner - (rows - 1) * gap) / rows
        )));

        const container = document.createElement('div');
        container.innerHTML = createShapeHTML(piece, false);
        const shapeEl = container.firstElementChild;

        const w = cols * trayCellSize + (cols - 1) * gap;
        const h = rows * trayCellSize + (rows - 1) * gap;

        shapeEl.style.width = `${w}px`;
        shapeEl.style.height = `${h}px`;
        // У .shape по умолчанию gap: 3px — выставляем тот же gap, из которого посчитаны w/h,
        // иначе колонки сетки не совпадут с вычисленным размером.
        shapeEl.style.gap = `${gap}px`;
        // Треки сетки в ПИКСЕЛЯХ, а не repeat(N, 1fr), который отдаёт createShapeHTML. На
        // старом WebView (в BlueStacks едет Chrome 101) 1fr вместе с aspect-ratio:1/1 на
        // .block разрешается вырожденно: колонка забирает весь размер фигуры вместо доли,
        // блоки распирает и обрезает по overflow. Текущий Chrome ту же разметку раскладывает
        // верно — поэтому баг ловился только на устройстве.
        shapeEl.style.gridTemplateColumns = `repeat(${cols}, ${trayCellSize}px)`;
        shapeEl.style.gridTemplateRows = `repeat(${rows}, ${trayCellSize}px)`;
        shapeEl.style.transform = 'none';

        slot.appendChild(shapeEl);
    });
}

function revealSecondChanceScreen() {
    secondChanceModal.classList.add('show');
    isGameOverSequenceActive = false;
    syncGameplayState();
}

function showSecondChance() {
    if (isGameOverSequenceActive || secondChanceModal.classList.contains('show')) {
        return;
    }

    isGameOverSequenceActive = true;
    trackEvent('second_chance_shown', { score: score });
    haptic.error();
    setCharacterState('sad');
    gameContainer.classList.add('game-over-transition');
    syncGameplayState();

    gameOverRevealTimeoutId = setTimeout(async () => {
        await waitForGameplayResume();
        revealSecondChanceScreen();
        gameOverRevealTimeoutId = null;
    }, GAME_OVER_REVEAL_DELAY_MS);
}

function showGameOver() {
    if (isGameOverSequenceActive || gameOverScreen.classList.contains('show')) {
        return;
    }

    isGameOverSequenceActive = true;
    finalizeBestScore();
    gameOverScoreEl.textContent = formatNumber(score);
    haptic.error();
    setCharacterState('sad');
    gameContainer.classList.add('game-over-transition');
    syncGameplayState();

    gameOverRevealTimeoutId = setTimeout(async () => {
        await waitForGameplayResume();
        revealGameOverScreen();
        gameOverRevealTimeoutId = null;
    }, GAME_OVER_REVEAL_DELAY_MS);
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

// Раскладывает подготовленный уровень (или чистую доску классики) в игровые сетки.
// setup приходит из adventure.js: { colors, obstacles, shapePool } — уже разобранный
// layout, чтобы ядро не зависело от формата данных уровней.
function applyLevelSetup(setup) {
    board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    obstacles = createEmptyObstacleGrid();
    activeShapePool = SHAPES_DATA;

    if (!setup) return;

    if (Array.isArray(setup.colors)) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const color = setup.colors[r] ? setup.colors[r][c] : null;
                if (color) board[r][c] = color;
            }
        }
    }

    if (Array.isArray(setup.obstacles)) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = setup.obstacles[r] ? setup.obstacles[r][c] : null;
                if (cell) obstacles[r][c] = { type: cell.type, hp: cell.hp, turns: cell.turns };
            }
        }
    }

    if (Array.isArray(setup.shapePool) && setup.shapePool.length > 0) {
        activeShapePool = setup.shapePool;
    }
}

function initGame() {
    clearPendingRefill();
    clearPendingGameOver();
    if (dragElement) {
        dragElement.remove();
        dragElement = null;
    }
    gameContainer.classList.remove('game-over-transition');
    setCharacterState('base');
    closeSettingsModal();
    setHammerArmed(false);
    applyLevelSetup(pendingLevelSetup);
    pendingLevelSetup = null;
    trayPieces = [null, null, null];
    score = 0;
    displayedScore = 0;
    isAnimating = false;
    isDragging = false;
    dragPieceIndex = -1;
    dragPointerType = 'mouse';
    comboStreak = 0;
    bestComboStreak = 0;
    hasUsedSecondChance = false;
    reachedMilestones = 0;
    sessionStartedAtMs = Date.now();
    updateScore();
    gameOverScreen.classList.remove('show');
    secondChanceModal.classList.remove('show');
    isGameOverSequenceActive = false;
    hideComboDisplay();
    if (document.body) {
        document.body.classList.toggle('mode-adventure', isAdventureMode());
    }
    boardEl.innerHTML = '';
    renderBoard();
    fillTray();
    syncGameplayState();
}

// Создаёт 64 пустых .cell div + кэш cellRefs, если их ещё нет. Ячейки нужны ВСЕГДА (в обоих
// режимах): они задают сетку/геометрию доски, дают фон-плитку для пустых клеток и координаты
// для системы частиц (cell.getBoundingClientRect()). В pixi-режиме блоки в них не добавляются.
function ensureBoardCells() {
    if (boardEl.children.length !== 0) return;
    cellRefs = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        cellRefs[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.id = `cell-${r}-${c}`;
            boardEl.appendChild(cell);
            cellRefs[r][c] = cell;
        }
    }
    boardHasDomBlocks = false;
}

// Снимает DOM-блоки/превью с ячеек (при переключении pixi<->dom, чтобы не дублировать с канвасом).
// Оверлеи препятствий (.cell-overlay) живут в тех же ячейках, но принадлежат обоим режимам —
// поэтому удаляем адресно только блоки, а не весь innerHTML.
function clearDomBoardBlocks() {
    for (let r = 0; r < BOARD_SIZE; r++) {
        const row = cellRefs[r];
        if (!row) continue;
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = row[c];
            if (!cell) continue;
            removeCellBlockElements(cell);
            cell.dataset.color = '';
            cell.style.backgroundColor = '';
            cell.classList.remove('preview', 'line-highlight');
        }
    }
    previewCells.clear();
    lineHighlightCells.clear();
    boardHasDomBlocks = false;
}

function removeCellBlockElements(cell) {
    const blocks = cell.querySelectorAll('.block-item');
    for (let i = 0; i < blocks.length; i++) {
        blocks[i].remove();
    }
}

function renderBoard() {
    ensureBoardCells();

    if (usePixi()) {
        // Блоки рисует WebGL-канвас. Гарантируем, что в DOM-ячейках блоков нет
        // (актуально при живом переключении с DOM-фолбэка).
        if (boardHasDomBlocks) {
            clearDomBoardBlocks();
        }
        window.pixiRenderer.syncBoard();
        renderObstacles();
        return;
    }

    // DOM-рендер блоков (фолбэк / ?renderer=dom): дифф состояния доски против DOM.
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = cellRefs[r][c];
            const currentColor = cell.dataset.color || null;
            const targetColor = board[r][c];

            const hasChild = cell.querySelector('.block-item') !== null;
            const shouldHaveChild = targetColor !== null;
            const logicalStateMatch = currentColor === targetColor;
            const domStateMatch = hasChild === shouldHaveChild;

            if (!logicalStateMatch || !domStateMatch) {
                removeCellBlockElements(cell);
                if (targetColor) {
                    const block = createBlockElement(targetColor);
                    cell.appendChild(block);
                }
                cell.dataset.color = targetColor || '';
            }
        }
    }
    boardHasDomBlocks = true;
    renderObstacles();
}

// Препятствия рисуются DOM-оверлеями внутри .cell в ОБОИХ режимах рендера: они не
// зависят от текстур и одинаково видны над WebGL-канвасом (z-index задан в styles.css).
// Дифф по dataset.obstacle, поэтому пересборка DOM происходит только при смене состояния.
function renderObstacles() {
    for (let r = 0; r < BOARD_SIZE; r++) {
        const row = cellRefs[r];
        if (!row) continue;

        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = row[c];
            if (!cell) continue;

            const obstacle = getObstacle(r, c);
            const signature = obstacle
                ? `${obstacle.type}:${obstacle.hp || 0}:${obstacle.turns || 0}`
                : '';

            if (cell.dataset.obstacle === signature) continue;
            cell.dataset.obstacle = signature;

            const existing = cell.querySelector('.cell-overlay');
            if (existing) existing.remove();
            cell.classList.toggle('cell-void', !!obstacle && obstacle.type === 'void');

            if (!obstacle || obstacle.type === 'void') continue;

            const overlay = document.createElement('div');
            overlay.className = `cell-overlay cell-overlay-${obstacle.type}`;

            if (obstacle.type === 'bomb') {
                overlay.dataset.turns = String(obstacle.turns);
                overlay.textContent = String(obstacle.turns);
                overlay.classList.toggle('cell-overlay-urgent', obstacle.turns <= 2);
            } else if (obstacle.hp > 1) {
                overlay.classList.add(`cell-overlay-hp${Math.min(3, obstacle.hp)}`);
            }

            cell.appendChild(overlay);
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

// Индексы всегда указывают в activeShapePool (в классике это SHAPES_DATA,
// в приключении — отфильтрованный набор уровня).
function getAllPossibleShapes() {
    const possibleShapes = [];

    for (let s = 0; s < activeShapePool.length; s++) {
        const shape = activeShapePool[s];
        let canPlaceShape = false;
        let placementCount = 0; // Количество возможных мест для размещения

        // Проверяем все возможные позиции на доске
        for (let r = 0; r <= BOARD_SIZE - shape.matrix.length; r++) {
            for (let c = 0; c <= BOARD_SIZE - shape.matrix[0].length; c++) {
                if (canPlace(shape, r, c)) {
                    canPlaceShape = true;
                    placementCount++; // Увеличиваем счетчик возможных мест
                }
            }
        }

        if (canPlaceShape) {
            // Добавляем индекс фигуры и вычисляем её "сложность" и количество возможных мест
            const complexity = shape.matrix.length * shape.matrix[0].length;
            // Вычисляем приоритет: сложность + коэффициент от количества доступных мест
            const priority = complexity + (placementCount / 10); // Делим на 10, чтобы не перекрывать влияние сложности
            possibleShapes.push({
                index: s,
                complexity: complexity,
                placementCount: placementCount,
                priority: priority
            });
        }
    }

    // Сортируем по приоритету: сначала более сложные фигуры с большим количеством доступных мест
    possibleShapes.sort((a, b) => b.priority - a.priority);

    // Возвращаем только индексы фигур в порядке приоритета
    return possibleShapes.map(item => item.index);
}

// Проверяет, можно ли разместить все 3 фигуры из данного списка на текущей доске
function canPlaceAllShapesInOrder(shapeList) {
    // Создаем копию доски для симуляции
    const tempBoard = board.map(row => [...row]);

    // Функция, которая проверяет возможность размещения фигуры на временной доске
    function canPlaceOnTempBoard(shape, startR, startC) {
        for (let r = 0; r < shape.matrix.length; r++) {
            for (let c = 0; c < shape.matrix[0].length; c++) {
                if (shape.matrix[r][c]) {
                    const boardR = startR + r;
                    const boardC = startC + c;
                    if (boardR < 0 || boardR >= BOARD_SIZE || boardC < 0 || boardC >= BOARD_SIZE || tempBoard[boardR][boardC] !== null) {
                        return false;
                    }
                    const obstacle = getObstacle(boardR, boardC);
                    if (obstacle && OBSTACLE_BLOCKS_PLACEMENT[obstacle.type]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    // Функция, которая размещает фигуру на временной доске
    function placeOnTempBoard(shape, startR, startC) {
        for (let r = 0; r < shape.matrix.length; r++) {
            for (let c = 0; c < shape.matrix[0].length; c++) {
                if (shape.matrix[r][c]) {
                    tempBoard[startR + r][startC + c] = shape.color;
                }
            }
        }
    }

    // Пробуем разместить все фигуры из списка
    for (const shapeIndex of shapeList) {
        const shape = activeShapePool[shapeIndex];
        let placed = false;

        // Ищем позицию для размещения фигуры
        for (let r = 0; r <= BOARD_SIZE - shape.matrix.length; r++) {
            for (let c = 0; c <= BOARD_SIZE - shape.matrix[0].length; c++) {
                if (canPlaceOnTempBoard(shape, r, c)) {
                    placeOnTempBoard(shape, r, c);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }

        // Если не можем разместить хотя бы одну фигуру, возвращаем false
        if (!placed) {
            return false;
        }
    }

    return true;
}

// Единая проверка «линия собрана» для реальной доски и для симуляции превью.
// Правила приключения:
//   • 'void' в сборке линии не участвует (линия из 6 клеток вместо 8);
//   • камни/ящики/бомбы считаются заполненными — они СОКРАЩАЮТ работу игроку;
//   • линия сбрасывается только если в ней есть хотя бы один цветной блок,
//     иначе ряд из одних камней «очищался» бы сам собой на каждом ходу.
function collectFullLines(readColor) {
    const rows = [];
    const cols = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
        let isFull = true;
        let hasColor = false;

        for (let c = 0; c < BOARD_SIZE; c++) {
            const obstacle = getObstacle(r, c);
            if (obstacle && obstacle.type === 'void') continue;
            if (readColor(r, c) !== null) {
                hasColor = true;
                continue;
            }
            if (obstacle && OBSTACLE_FILLS_LINE[obstacle.type]) continue;
            isFull = false;
            break;
        }

        if (isFull && hasColor) rows.push(r);
    }

    for (let c = 0; c < BOARD_SIZE; c++) {
        let isFull = true;
        let hasColor = false;

        for (let r = 0; r < BOARD_SIZE; r++) {
            const obstacle = getObstacle(r, c);
            if (obstacle && obstacle.type === 'void') continue;
            if (readColor(r, c) !== null) {
                hasColor = true;
                continue;
            }
            if (obstacle && OBSTACLE_FILLS_LINE[obstacle.type]) continue;
            isFull = false;
            break;
        }

        if (isFull && hasColor) cols.push(c);
    }

    return { rows: rows, cols: cols };
}

function wouldCreateLineClear(shape, startR, startC) {
    // Validate inputs first
    if (!shape || startR < 0 || startC < 0) {
        return { rows: [], cols: [] };
    }

    // Create a temporary board to simulate the placement
    const tempBoard = board.map(row => [...row]);

    // Place the shape on the temporary board
    for (let r = 0; r < shape.matrix.length; r++) {
        for (let c = 0; c < shape.matrix[0].length; c++) {
            if (shape.matrix[r][c]) {
                const boardR = startR + r;
                const boardC = startC + c;
                if (boardR >= 0 && boardR < BOARD_SIZE && boardC >= 0 && boardC < BOARD_SIZE) {
                    tempBoard[boardR][boardC] = shape.color;
                }
            }
        }
    }

    return collectFullLines((r, c) => tempBoard[r][c]);
}

function fillTray() {
    const emptyCount = trayPieces.filter(p => !p).length;

    if (emptyCount === 3) {
        clearPendingRefill();
        isRefillingTray = true;
        renderTray(true);

        const refillStartTimeoutId = setTimeout(async () => {
            await waitForGameplayResume();

            // Получаем все фигуры, которые можно разместить на текущей доске, в порядке убывания сложности
            const possibleShapeIndices = getAllPossibleShapes();

            // Если нет доступных фигур, игра закончится в checkGameOver
            // Но если они есть, выбираем 3 такие фигуры, чтобы все они могли быть размещены
            let selectedShapes = [];

            if (possibleShapeIndices.length > 0) {
                // Попробуем найти комбинацию из 3 фигур, которую можно разместить
                let foundValidCombination = false;

                // Попробуем найти комбинацию без дубликатов
                const maxAttempts = 100;
                let attempts = 0;

                while (!foundValidCombination && attempts < maxAttempts && possibleShapeIndices.length >= 3) {
                    attempts++;

                    // Создаем копию массива возможных фигур и перемешиваем
                    const shuffledIndices = [...possibleShapeIndices].sort(() => Math.random() - 0.5);

                    // Берем первые 3 разных фигуры из перемешанного массива
                    const tempSelected = [];
                    const usedIndices = new Set();

                    for (const idx of shuffledIndices) {
                        if (tempSelected.length >= 3) break;
                        if (!usedIndices.has(idx)) {
                            tempSelected.push(idx);
                            usedIndices.add(idx);
                        }
                    }

                    // Проверяем, можно ли разместить все 3 выбранные фигуры
                    if (tempSelected.length === 3 && canPlaceAllShapesInOrder(tempSelected)) {
                        selectedShapes = tempSelected.map(idx => cloneShape(activeShapePool[idx]));
                        foundValidCombination = true;
                    }
                }

                // Если не нашлась комбинация из 3 разных фигур, пробуем с меньшим приоритетом уникальности
                if (!foundValidCombination && possibleShapeIndices.length > 0) {
                    // Берем 3 фигуры, максимально избегая дубликатов
                    const tempSelected = [];
                    const usedIndices = new Set();

                    for (let i = 0; i < 3; i++) {
                        let selectedIndex;

                        if (i === 0) {
                            // Для первой фигуры берем самую сложную (если возможно)
                            selectedIndex = possibleShapeIndices[0];
                        } else {
                            // Для последующих стараемся избегать дубликатов
                            let candidateIndex = -1;

                            // Сначала пытаемся найти фигуру, которой нет в текущем списке
                            for (let j = 0; j < possibleShapeIndices.length; j++) {
                                const idx = possibleShapeIndices[j];
                                if (!usedIndices.has(idx)) {
                                    candidateIndex = idx;
                                    break;
                                }
                            }

                            // Если все фигуры уже используются, берем любую
                            if (candidateIndex === -1) {
                                selectedIndex = possibleShapeIndices[0]; // или первую доступную
                            } else {
                                selectedIndex = candidateIndex;
                            }
                        }

                        tempSelected.push(selectedIndex);
                        usedIndices.add(selectedIndex);
                    }

                    // Проверяем, можно ли разместить эти фигуры
                    if (canPlaceAllShapesInOrder(tempSelected)) {
                        selectedShapes = tempSelected.map(idx => cloneShape(activeShapePool[idx]));
                    } else {
                        // Если нельзя разместить, берем три разные фигуры без проверки размещения
                        const differentShapes = [];
                        const usedShapes = new Set();

                        for (const idx of possibleShapeIndices) {
                            if (differentShapes.length >= 3) break;

                            // Проверяем, является ли фигура уникальной (на основе матрицы)
                            const shapeMatrixKey = JSON.stringify(activeShapePool[idx].matrix);
                            if (!usedShapes.has(shapeMatrixKey)) {
                                differentShapes.push(idx);
                                usedShapes.add(shapeMatrixKey);
                            }
                        }

                        // Если уникальных не хватает, добавляем оставшиеся
                        if (differentShapes.length < 3) {
                            for (const idx of possibleShapeIndices) {
                                if (differentShapes.length >= 3) break;
                                differentShapes.push(idx);
                            }
                        }

                        selectedShapes = differentShapes.slice(0, 3).map(idx => cloneShape(activeShapePool[idx]));
                    }
                }

                // Если и это не помогло, просто берём первые 3 возможные фигуры
                if (selectedShapes.length === 0 && possibleShapeIndices.length > 0) {
                    const limitedIndices = possibleShapeIndices.slice(0, 3);
                    selectedShapes = limitedIndices.map(idx => cloneShape(activeShapePool[idx]));
                }
            }

            // Заполняем трей фигурами
            for (let i = 0; i < 3; i++) {
                // Если смогли подобрать подходящие фигуры, используем их, иначе берем случайную
                const randomShape = selectedShapes[i] || randomPoolShape();

                const slotFillTimeoutId = setTimeout(async () => {
                    await waitForGameplayResume();

                    trayPieces[i] = randomShape;
                    renderTray(false, new Set([i]));

                    playSound('click');

                    const slot = traySlots[i];
                    if (slot) {
                        const rect = slot.getBoundingClientRect();
                        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, randomShape.color, 42, 7, 'tray');
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
            const longestSide = Math.max(rows, cols);
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
            const minTrayCellSize = longestSide >= 5 ? 12 : longestSide >= 4 ? 16 : 20;
            trayCellSize = Math.min(Math.max(trayCellSize, minTrayCellSize), 38);

            const container = document.createElement('div');
            const shouldPop = popIndexes instanceof Set ? popIndexes.has(i) : false;
            container.innerHTML = createShapeHTML(piece, shouldPop);
            const shapeEl = container.firstElementChild;

            const w = cols * trayCellSize + (cols - 1) * gap;
            const h = rows * trayCellSize + (rows - 1) * gap;

            shapeEl.classList.add('tray-shape');
            shapeEl.style.width = `${w}px`;
            shapeEl.style.height = `${h}px`;
            // Пиксельные треки вместо 1fr — см. комментарий в renderRewardShapes: на старом
            // WebView 1fr + aspect-ratio разрешается вырожденно. Размер ячейки здесь известен
            // точно, поэтому фиксируем его и убираем саму возможность.
            shapeEl.style.gap = `${gap}px`;
            shapeEl.style.gridTemplateColumns = `repeat(${cols}, ${trayCellSize}px)`;
            shapeEl.style.gridTemplateRows = `repeat(${rows}, ${trayCellSize}px)`;

            slot.appendChild(shapeEl);
            slot.onpointerdown = e => startDrag(e, i);
        }
    }
}

function startDrag(e, index) {
    if (!trayPieces[index] || isDragging || isAnimating || !canInteractWithGameplay()) return;
    // Пока молоток «в руке», трей не перетаскивается — иначе тап по фигуре и тап по
    // доске конфликтуют, и игрок тратит бустер вслепую.
    if (isHammerArmed) return;

    e.preventDefault();

    const piece = trayPieces[index];
    cellSize = getCurrentCellSize();
    dragPointerType = e.pointerType === 'touch' ? 'touch' : 'mouse';

    haptic.track(e.clientX, e.clientY);
    playSound('pick');
    haptic({ x: e.clientX, y: e.clientY });

    setCharacterState('wait');

    isDragging = true;
    dragPieceIndex = index;

    dragElement = document.createElement('div');
    dragElement.className = 'drag-clone';
    dragElement.innerHTML = createShapeHTML(piece, false);

    const shapeEl = dragElement.firstElementChild;
    shapeEl.style.width = `${piece.matrix[0].length * cellSize + (piece.matrix[0].length - 1) * gapSize}px`;
    shapeEl.style.height = `${piece.matrix.length * cellSize + (piece.matrix.length - 1) * gapSize}px`;
    // Пиксельные треки вместо 1fr (см. renderRewardShapes). Здесь это ещё и про точность
    // дропа: клон должен лежать на той же сетке, из которой getBoardCoordinates берёт
    // целевую клетку.
    shapeEl.style.gap = `${gapSize}px`;
    shapeEl.style.gridTemplateColumns = `repeat(${piece.matrix[0].length}, ${cellSize}px)`;
    shapeEl.style.gridTemplateRows = `repeat(${piece.matrix.length}, ${cellSize}px)`;

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

    // Кэшируем геометрию доски и стартовую позицию драга на время перетаскивания,
    // сбрасываем «память» превью, чтобы первый апдейт гарантированно отрисовался.
    cachedBoardRect = boardEl.getBoundingClientRect();
    dragVirtualX = dragAnchorX;
    dragVirtualY = dragAnchorY;
    lastPreviewR = NaN;
    lastPreviewC = NaN;
    lastPreviewPieceIndex = -1;

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

    const gainX = dragPointerType === 'touch' ? DRAG_GAIN_X : 1;
    const gainY = dragPointerType === 'touch' ? DRAG_GAIN_Y : 1;
    const dx = (e.clientX - dragStartPointerX) * gainX;
    const dy = (e.clientY - dragStartPointerY) * gainY;
    const virtualX = dragAnchorX + dx;
    const virtualY = dragAnchorY + dy;

    // Запоминаем позицию и сразу двигаем клон (дёшево, GPU-transform).
    // Дорогой апдейт превью коалесим в один вызов на кадр.
    dragVirtualX = virtualX;
    dragVirtualY = virtualY;
    moveDrag(virtualX, virtualY);
    schedulePreviewUpdate();
}

function moveDrag(x, y) {
    if (!dragElement) return;
    // ОПТИМИЗАЦИЯ: GPU-ускорение через translate3d без reflow
    dragElement.style.transform = `translate3d(${x - dragOffsetX}px, ${y - dragOffsetY}px, 0)`;
}

// rAF-троттлинг: несколько pointermove за кадр сворачиваются в один updatePreview.
function schedulePreviewUpdate() {
    if (previewRafId !== 0) return;
    previewRafId = requestAnimationFrame(() => {
        previewRafId = 0;
        if (!isDragging) return;
        updatePreview();
    });
}

// Отмена запланированного апдейта и сброс «памяти» превью (на завершении/отмене драга).
function cancelPreviewUpdate() {
    if (previewRafId !== 0) {
        cancelAnimationFrame(previewRafId);
        previewRafId = 0;
    }
    lastPreviewR = NaN;
    lastPreviewC = NaN;
    lastPreviewPieceIndex = -1;
}

function updatePreview() {
    const coords = getBoardCoordinates();
    const piece = dragPieceIndex >= 0 ? trayPieces[dragPieceIndex] : null;
    const valid = coords && piece && canPlace(piece, coords.r, coords.c);

    if (valid) {
        // Ранний выход: та же ячейка и та же фигура — превью не изменится.
        if (coords.r === lastPreviewR && coords.c === lastPreviewC && dragPieceIndex === lastPreviewPieceIndex) {
            return;
        }
        lastPreviewR = coords.r;
        lastPreviewC = coords.c;
        lastPreviewPieceIndex = dragPieceIndex;
        drawPreview(piece, coords.r, coords.c);
    } else {
        // Позиция недопустима — снимаем превью, если оно было.
        if (previewCells.size > 0 || lineHighlightCells.size > 0 || pixiPreviewActive) {
            clearPreview();
        }
        lastPreviewR = NaN;
        lastPreviewC = NaN;
        lastPreviewPieceIndex = -1;
    }
}

function getBoardCoordinates() {
    if (!dragElement) return null;

    if (!Number.isFinite(cellSize) || cellSize <= 0) {
        cellSize = getCurrentCellSize();
    }

    // Доска при драге не двигается -> кэшируем её rect.
    // Позиция клона нам известна (мы сами её задаём в moveDrag),
    // поэтому НЕ читаем getBoundingClientRect у dragElement каждый кадр — это убирает форс reflow.
    if (!cachedBoardRect) {
        cachedBoardRect = boardEl.getBoundingClientRect();
    }

    const relX = (dragVirtualX - dragOffsetX) - cachedBoardRect.left;
    const relY = (dragVirtualY - dragOffsetY) - cachedBoardRect.top;

    const c = Math.round(relX / (cellSize + gapSize));
    const r = Math.round(relY / (cellSize + gapSize));

    currentCoords.r = r;
    currentCoords.c = c;
    return currentCoords;
}

function clearPreview() {
    if (usePixi()) {
        if (pixiPreviewActive) {
            window.pixiRenderer.clearPreview();
            pixiPreviewActive = false;
        }
        return;
    }
    // Быстрый путь: снимаем классы только с отслеживаемых ячеек (без обхода всего DOM).
    if (previewCells.size > 0 || lineHighlightCells.size > 0) {
        previewCells.forEach(cell => {
            cell.classList.remove('preview');
            cell.style.backgroundColor = '';
        });
        previewCells.clear();
        lineHighlightCells.forEach(cell => {
            cell.classList.remove('line-highlight');
            cell.style.removeProperty('--line-preview-color');
        });
        lineHighlightCells.clear();
        return;
    }

    // Фолбэк на случай рассинхрона состояния (используется только вне горячего пути).
    document.querySelectorAll('.cell.preview').forEach(el => {
        el.classList.remove('preview');
        el.style.backgroundColor = ''; // Reset custom background
    });
    document.querySelectorAll('.cell.line-highlight').forEach(el => {
        el.classList.remove('line-highlight');
        el.style.removeProperty('--line-preview-color');
    });
}

// Резолвим цвет фигуры (CSS-var -> hex) один раз и кэшируем: цвета за драг не меняются.
function resolveShapeColor(shape) {
    const raw = shape && shape.color;
    if (!raw) return '#888888';

    const cached = shapeColorCache.get(raw);
    if (cached) return cached;

    let resolved = raw;
    if (raw.includes('var(')) {
        const varName = raw.replace('var(', '').replace(')', '').trim();
        resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888888';
    }
    shapeColorCache.set(raw, resolved);
    return resolved;
}

// Helper function to convert hex color to RGBA
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawPreview(shape, startR, startC) {
    if (usePixi()) {
        if (!shape || startR < 0 || startC < 0) {
            clearPreview();
            return;
        }
        const hex = resolveShapeColor(shape);
        const tint = (typeof hex === 'string' && hex[0] === '#') ? (parseInt(hex.slice(1), 16) || 0xffffff) : 0xffffff;
        let rows = [];
        let cols = [];
        try {
            const lineClear = wouldCreateLineClear(shape, startR, startC);
            if (lineClear) {
                rows = lineClear.rows || [];
                cols = lineClear.cols || [];
            }
        } catch (e) {
            console.error('drawPreview (pixi) line-clear check failed:', e);
        }
        window.pixiRenderer.drawPreview(shape, startR, startC, tint, rows, cols);
        pixiPreviewActive = true;
        return;
    }

    // Снимаем предыдущее превью (по отслеживаемым ячейкам — дёшево). Один вызов, не два.
    clearPreview();

    // Validate inputs
    if (!shape || startR < 0 || startC < 0) {
        return;
    }

    // Цвет резолвится из кэша — без getComputedStyle на каждый апдейт.
    const shapeColor = resolveShapeColor(shape);

    // Add preview styling to the shape cells
    for (let r = 0; r < shape.matrix.length; r++) {
        for (let c = 0; c < shape.matrix[0].length; c++) {
            if (shape.matrix && shape.matrix[r] && shape.matrix[r][c]) {
                const cell = getCell(startR + r, startC + c);
                if (cell) {
                    cell.classList.add('preview');

                    // Apply the shape's color with reduced opacity (semi-transparent)
                    // ~0.5 opacity for preview
                    cell.style.backgroundColor = hexToRgba(shapeColor, 0.5);
                    previewCells.add(cell);
                }
            }
        }
    }

    // Check if placing this shape would cause any line clears
    try {
        const wouldCauseLineClear = wouldCreateLineClear(shape, startR, startC);
        if (wouldCauseLineClear.rows.length > 0 || wouldCauseLineClear.cols.length > 0) {
            const lineColorInPreview = hexToRgba(shapeColor, 0.7);
            const lineColorPlain = hexToRgba(shapeColor, 0.6);

            // Highlight the lines that would be cleared with the shape's color.
            // Принадлежность ячейки превью берём из previewCells (без classList.contains после записи).
            for (const row of wouldCauseLineClear.rows) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    const cell = getCell(row, c);
                    if (cell) {
                        cell.classList.add('line-highlight');
                        cell.style.setProperty(
                            '--line-preview-color',
                            previewCells.has(cell) ? lineColorInPreview : lineColorPlain
                        );
                        lineHighlightCells.add(cell);
                    }
                }
            }

            for (const col of wouldCauseLineClear.cols) {
                for (let r = 0; r < BOARD_SIZE; r++) {
                    const cell = getCell(r, col);
                    if (cell) {
                        cell.classList.add('line-highlight');
                        cell.style.setProperty(
                            '--line-preview-color',
                            previewCells.has(cell) ? lineColorInPreview : lineColorPlain
                        );
                        lineHighlightCells.add(cell);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error in drawPreview when checking for line clears:", e);
    }
}

async function endDrag(e) {
    if (!isDragging) return;

    if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        haptic.track(e.clientX, e.clientY);
    }

    removeDragListeners();
    cancelPreviewUpdate();

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
    dragPointerType = 'mouse';
    cachedBoardRect = null;

    if (coords && canPlace(piece, coords.r, coords.c)) {
        const blocksPlaced = placeShape(piece, coords.r, coords.c);
        trayPieces[savedDragPieceIndex] = null;

        haptic.confirm(e ? { x: e.clientX, y: e.clientY } : null);
        renderBoard();

        if (isThreeByThreeSquare(piece)) {
            playSound('hardPop');
        }

        for (let r = 0; r < piece.matrix.length; r++) {
            for (let c = 0; c < piece.matrix[0].length; c++) {
                if (piece.matrix[r][c]) {
                    const cellR = coords.r + r;
                    const cellC = coords.c + c;
                    const cell = getCell(cellR, cellC);
                    if (cell) {
                        const rect = cell.getBoundingClientRect();
                        createLandingParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, piece.color);
                    }
                }
            }
        }

        traySlots[savedDragPieceIndex].innerHTML = '';
        const clearResult = await checkLines(blocksPlaced);
        const explodedBombs = tickBombCountdowns();
        if (currentCharacterState === 'wait') {
            setCharacterState('base');
        }
        // Хук приключения вызывается ОДИН раз за ход и уже после разбора линий,
        // поэтому adventure.js видит финальное состояние доски.
        adventureHook('onPlacement', {
            blocksPlaced: blocksPlaced,
            lines: clearResult.lines,
            combo: clearResult.combo,
            collected: clearResult.tally,
            score: score,
            explodedBombs: explodedBombs
        });
        renderTray();
        fillTray();
    } else {
        playSound('click');
        if (traySlots[savedDragPieceIndex].firstElementChild) {
            traySlots[savedDragPieceIndex].firstElementChild.style.opacity = '1';
        }
        traySlots[savedDragPieceIndex].style.opacity = '1';
        if (currentCharacterState === 'wait') {
            setCharacterState('base');
        }
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
    cancelPreviewUpdate();

    if (dragElement) {
        dragElement.remove();
        dragElement = null;
    }

    clearPreview();
    isDragging = false;
    dragPieceIndex = -1;
    dragPointerType = 'mouse';
    cachedBoardRect = null;

    if (savedDragPieceIndex >= 0 && traySlots[savedDragPieceIndex]?.firstElementChild) {
        traySlots[savedDragPieceIndex].firstElementChild.style.opacity = '1';
    }

    if (currentCharacterState === 'wait') {
        setCharacterState('base');
    }

    haptic.release();
}

function refreshLayoutMetrics() {
    cellSize = getCurrentCellSize();
    // Геометрия доски могла измениться (resize/смена ориентации) — пересчитаем лениво.
    cachedBoardRect = null;
    updateSplashPlayButtonPosition();
    // Подгоняем WebGL-канвас под новый размер .board и перепозиционируем спрайты.
    if (usePixi()) {
        window.pixiRenderer.layout();
    }
}

function canPlace(shape, startR, startC) {
    if (!shape || !shape.matrix) return false;

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
                const obstacle = getObstacle(boardR, boardC);
                if (obstacle && OBSTACLE_BLOCKS_PLACEMENT[obstacle.type]) {
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

function createCollectedTally() {
    return { blocks: 0, crates: 0, rocks: 0, ice: 0, gems: 0, bombs: 0, colors: {} };
}

// Разбирает одну ячейку сброшенной линии: цветной блок исчезает, препятствия
// получают урон. Все снятые цели складываются в tally для хука приключения.
function resolveClearedCell(r, c, tally) {
    const obstacle = getObstacle(r, c);
    const color = board[r][c];

    if (color !== null) {
        board[r][c] = null;
        tally.blocks += 1;
        tally.colors[color] = (tally.colors[color] || 0) + 1;

        if (obstacle && obstacle.type === 'gem') {
            obstacles[r][c] = null;
            tally.gems += 1;
        } else if (obstacle && obstacle.type === 'ice') {
            obstacle.hp -= 1;
            if (obstacle.hp <= 0) {
                obstacles[r][c] = null;
                tally.ice += 1;
            }
        }
        return;
    }

    if (!obstacle) return;

    if (obstacle.type === 'rock' || obstacle.type === 'crate') {
        obstacle.hp -= 1;
        if (obstacle.hp <= 0) {
            obstacles[r][c] = null;
            if (obstacle.type === 'crate') tally.crates += 1;
            else tally.rocks += 1;
        }
    } else if (obstacle.type === 'bomb') {
        // Линия прошла через бомбу — обезвредили.
        obstacles[r][c] = null;
        tally.bombs += 1;
    }
}

// Цвет частиц для ячейки: у цветного блока — его палитра, у препятствия — своя.
function getClearParticleColor(r, c) {
    const color = board[r][c];
    if (color) return color;

    const obstacle = getObstacle(r, c);
    if (!obstacle) return COLORS.purple;

    return OBSTACLE_PARTICLE_TOKENS[obstacle.type] || COLORS.purple;
}

async function checkLines(blocksPlaced) {
    const tally = createCollectedTally();
    const { rows: rowsToClear, cols: colsToClear } = collectFullLines((r, c) => board[r][c]);

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
        if (comboStreak > bestComboStreak) {
            bestComboStreak = comboStreak;
        }
    } else {
        comboStreak = 0;
    }

    const initialPoints = 10 * blocksPlaced * (totalLines + 1);
    score += initialPoints;
    updateScore();

    if (lastPlacementCoords) {
        const centerR = lastPlacementCoords.r;
        const centerC = lastPlacementCoords.c;
        const cell = getCell(centerR, centerC);
        if (cell) {
            const rect = cell.getBoundingClientRect();
            createScorePopup(rect.left + rect.width / 2, rect.top + rect.height / 2, `+${initialPoints}`);
        }
    }

    if (totalLines > 0) {
        isAnimating = true;

        try {
            setCharacterState('fire');
            renderBoard();

            const linePoints = totalLines * 100;
            const comboBonus = comboStreak > 1 ? (comboStreak - 1) * 50 : 0;
            const extraPoints = linePoints + comboBonus;

            score += extraPoints;
            updateScore();

            if (lastPlacementCoords) {
                const centerR = lastPlacementCoords.r;
                const centerC = lastPlacementCoords.c;
                const cell = getCell(centerR, centerC);
                if (cell) {
                    const rect = cell.getBoundingClientRect();
                    const praiseLines = getMessages().praiseLines;
                    const praise = praiseLines[Math.min(totalLines - 1, praiseLines.length - 1)];
                    createPraisePopup(praise);

                    if (totalLines > 1 && extraPoints > 0) {
                        createScorePopup(rect.left + rect.width / 2, rect.top + rect.height / 2 + rect.height, `+${extraPoints}`);
                    }
                }
            }

            const cellsToClear = new Set();
            if (comboStreak >= 2) {
                showComboDisplay(`${getMessages().comboLabel} x${comboStreak}`);
            } else {
                hideComboDisplay();
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
            }).filter(item => {
                // Дырки в доске не сносятся и не дают частиц.
                const obstacle = getObstacle(item.r, item.c);
                return !obstacle || obstacle.type !== 'void';
            });

            if (lastPlacementCoords) {
                coordsArray.sort((a, b) => {
                    const distA = Math.abs(a.r - lastPlacementCoords.r) + Math.abs(a.c - lastPlacementCoords.c);
                    const distB = Math.abs(b.r - lastPlacementCoords.r) + Math.abs(b.c - lastPlacementCoords.c);
                    return distA - distB;
                });
            }

            await waitForGameplayResume();
            await new Promise(resolve => setTimeout(resolve, 120));

            // Последовательное исчезновение: от ближайших к последней установке к дальним
            for (const item of coordsArray) {
                const r = item.r;
                const c = item.c;
                const cell = getCell(r, c);
                const hadObstacle = getObstacle(r, c) !== null;

                if (cell) {
                    const rect = cell.getBoundingClientRect();
                    createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, getClearParticleColor(r, c), 14);

                    if (board[r][c] !== null) {
                        if (usePixi()) {
                            // GPU-анимация сжигания блока (scale->0 + fade) вместо CSS @keyframes blast.
                            window.pixiRenderer.blastCell(r, c);
                        } else {
                            const blockEl = cell.querySelector('.block-item');
                            if (blockEl) {
                                blockEl.classList.add('clearing');
                            }
                        }
                    } else if (hadObstacle) {
                        cell.classList.add('cell-hit');
                        setTimeout(() => cell.classList.remove('cell-hit'), 260);
                    }
                }

                await waitForGameplayResume();
                await new Promise(resolve => setTimeout(resolve, 45));

                resolveClearedCell(r, c, tally);
                if (hadObstacle) {
                    renderObstacles();
                }
                if (cell) {
                    const blockEl = cell.querySelector('.block-item');
                    if (blockEl) {
                        blockEl.style.opacity = '0';
                    }
                }
            }

            await waitForGameplayResume();
            await new Promise(resolve => setTimeout(resolve, 150));

            hideComboDisplay();

            renderBoard();
        } finally {
            isAnimating = false;
        }
    }

    lastPlacementCoords = null;
    return { lines: totalLines, combo: comboStreak, tally: tally };
}

// Обратный отсчёт бомб тикает РОВНО один раз за установленную фигуру и уже после
// разбора линий: бомба, снесённая этим же ходом, обезврежена и в отсчёт не попадает.
// Возвращает список рванувших бомб — решение о проигрыше принимает adventure.js.
function tickBombCountdowns() {
    if (!isAdventureMode()) return [];

    const exploded = [];
    let hasBombs = false;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const obstacle = getObstacle(r, c);
            if (!obstacle || obstacle.type !== 'bomb') continue;

            hasBombs = true;
            obstacle.turns -= 1;
            if (obstacle.turns <= 0) {
                exploded.push({ r: r, c: c });
            }
        }
    }

    if (hasBombs) {
        renderObstacles();
    }

    if (exploded.length > 0) {
        exploded.forEach(({ r, c }) => {
            const cell = getCell(r, c);
            if (!cell) return;
            const rect = cell.getBoundingClientRect();
            createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 'obstacle-bomb', 20, 14);
        });
        playSound('hardPop');
        haptic.error();
    }

    return exploded;
}

// --- БУСТЕРЫ (команды из adventure.js) ---

function setHammerArmed(armed) {
    isHammerArmed = !!armed && isAdventureMode();
    if (document.body) {
        document.body.classList.toggle('hammer-armed', isHammerArmed);
    }
    return isHammerArmed;
}

// Молоток: точечно уничтожает содержимое одной ячейки. Препятствие снимается целиком
// (независимо от hp) — это и есть ценность бустера. Возвращает tally или null.
function hammerCell(r, c) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;

    const obstacle = getObstacle(r, c);
    const color = board[r][c];

    if (!color && (!obstacle || obstacle.type === 'void')) return null;

    const tally = createCollectedTally();
    const cell = getCell(r, c);

    if (cell) {
        const rect = cell.getBoundingClientRect();
        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, getClearParticleColor(r, c), 16, 10);
    }

    if (color !== null) {
        board[r][c] = null;
        tally.blocks += 1;
        tally.colors[color] = (tally.colors[color] || 0) + 1;
        if (usePixi()) {
            window.pixiRenderer.blastCell(r, c);
        }
    }

    if (obstacle) {
        obstacles[r][c] = null;
        if (obstacle.type === 'crate') tally.crates += 1;
        else if (obstacle.type === 'rock') tally.rocks += 1;
        else if (obstacle.type === 'ice') tally.ice += 1;
        else if (obstacle.type === 'bomb') tally.bombs += 1;
        else if (obstacle.type === 'gem') tally.gems += 1;
    }

    playSound('hardPop');
    haptic.confirm();
    renderBoard();
    return tally;
}

// Сброс таймеров бомб (rewarded «дать ещё времени»): поднимаем отсчёт до n там,
// где осталось меньше. Сами бомбы остаются на доске — цель уровня не обесценивается.
function addBombTurns(turns) {
    let touched = 0;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const obstacle = getObstacle(r, c);
            if (!obstacle || obstacle.type !== 'bomb') continue;
            if (obstacle.turns < turns) {
                obstacle.turns = turns;
                touched += 1;
            }
        }
    }

    if (touched > 0) renderObstacles();
    return touched;
}

// Перемешать трей: сбрасываем все три слота и запускаем обычный анимированный добор.
function reshuffleTray() {
    if (isAnimating) return false;
    clearPendingRefill();
    trayPieces = [null, null, null];
    playSound('click');
    fillTray();
    return true;
}

// Сколько целей ещё осталось на доске — нужно для целей вида 'all'.
function countRemainingTargets() {
    const counts = { crate: 0, ice: 0, gem: 0, bomb: 0, rock: 0 };

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const obstacle = getObstacle(r, c);
            if (obstacle && counts[obstacle.type] !== undefined) {
                counts[obstacle.type] += 1;
            }
        }
    }

    return counts;
}

function hasAnyValidMove() {
    for (let i = 0; i < trayPieces.length; i++) {
        const piece = trayPieces[i];
        if (!piece) continue;

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (canPlace(piece, r, c)) return true;
            }
        }
    }
    return false;
}

function createScorePopup(x, y, text) {
    const p = document.createElement('div');
    p.className = 'score-popup';
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), SCORE_POPUP_LIFETIME_MS);
}

function createPraisePopup(text) {
    const p = document.createElement('div');
    p.className = 'praise-popup';
    p.textContent = text;
    p.style.left = `${window.innerWidth / 2}px`;
    p.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), PRAISE_POPUP_LIFETIME_MS);
}

function createParticles(x, y, colorStr, particleSize = 14, count = 7, particleType = 'explosion') {
    // Вызываем метод из новой системы частиц
    particleSystem.createParticles(x, y, colorStr, particleSize, count, particleType);
}

function createLandingParticles(x, y, colorStr, particleType = 'landing') {
    // Вызываем метод из новой системы частиц
    particleSystem.createLandingParticles(x, y, colorStr, particleType);
}

// Единая точка отправки игровых событий. Отвечает только тот хост, у которого есть
// приёмник для продуктовой телеметрии — там, где его нет, вызов молча ничего не делает,
// поэтому обёртки на местах вызова не нужны.
function trackEvent(name, params) {
    if (window.GameAds && typeof window.GameAds.logEvent === 'function') {
        window.GameAds.logEvent(name, params);
    }
}

// Пороги счёта → levelComplete. Каждый порог отправляется не больше одного раза за партию;
// счётчик сбрасывается в initGame вместе с остальным состоянием сессии.
function reportScoreMilestones() {
    while (reachedMilestones < SCORE_MILESTONES.length && score >= SCORE_MILESTONES[reachedMilestones]) {
        reachedMilestones++;
        if (window.GameAds && typeof window.GameAds.levelComplete === 'function') {
            window.GameAds.levelComplete(reachedMilestones, { score: score });
        }
    }
}

function updateScore() {
    // Вехи счёта — воронка КЛАССИКИ. В приключении прогресс измеряется уровнями,
    // и levelComplete отправляет adventure.js по факту прохождения.
    if (!isAdventureMode()) {
        reportScoreMilestones();
    }
    adventureHook('onScoreChanged', score);
    scoreEl.textContent = formatNumber(score);

    const duration = SCORE_ANIMATION_DURATION_MS;
    const startVal = displayedScore;
    const endVal = score;
    const startTime = performance.now();
    const currentAnimationToken = ++scoreAnimationToken;

    if (startVal === endVal) {
        displayedScore = endVal;
        mainScoreEl.textContent = formatNumber(displayedScore);
        return;
    }

    function animate(now) {
        if (currentAnimationToken !== scoreAnimationToken) {
            return;
        }

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress * (2 - progress);
        const nextDisplayedScore = Math.floor(startVal + (endVal - startVal) * ease);

        if (nextDisplayedScore !== displayedScore) {
            displayedScore = nextDisplayedScore;
            mainScoreEl.textContent = formatNumber(displayedScore);
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            displayedScore = endVal;
            mainScoreEl.textContent = formatNumber(displayedScore);
        }
    }
    requestAnimationFrame(animate);
}

function checkGameOver() {
    if (isGameOverSequenceActive || gameOverScreen.classList.contains('show') || secondChanceModal.classList.contains('show')) {
        return;
    }

    // Приключение уже показывает итоги уровня — не мешаем своим тупиком.
    if (isInputLocked) {
        return;
    }

    clearPendingGameOver();

    if (hasAnyValidMove()) {
        return;
    }

    // В приключении тупик — это не конец партии, а провал уровня: решение
    // (реклама за перемешивание, повтор, выход на карту) принимает adventure.js.
    if (isAdventureMode()) {
        gameOverTimeoutId = setTimeout(async () => {
            await waitForGameplayResume();
            adventureHook('onDeadlock');
            gameOverTimeoutId = null;
        }, 450);
        return;
    }

    gameOverTimeoutId = setTimeout(async () => {
        await waitForGameplayResume();

        if (!hasUsedSecondChance && window.GameAds && window.GameAds.hasProvider()) {
            pendingRewardShapes = generateRewardShapes();
            renderRewardShapes(pendingRewardShapes);
            showSecondChance();
        } else {
            showGameOver();
        }

        gameOverTimeoutId = null;
    }, 500);
}

applyTranslations(currentLanguage);
loadBestScore();
syncSoundToggleUI();
void whenLanguageReady();
void initializePlatformLifecycle();
void prepareSplashPlay();

async function syncBestScoreWithPlatform() {
    if (!window.GamePlatform) {
        return;
    }

    try {
        const currentLocal = bestScore || 0;
        const cloudScore = await window.GamePlatform.getBestScore();

        // null — у хоста нет облачного стора (в отличие от 0, который является настоящим
        // сохранённым результатом). Писать некуда, и рейтинг трогать нельзя: иначе на каждом
        // старте партии улетал бы лишний submit в API с его лимитом на сабмиты.
        if (cloudScore === null) {
            return;
        }

        if (cloudScore > currentLocal) {
            bestScore = cloudScore;
            try {
                window.localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
            } catch (e) { }
            updateBestScoreDisplay();
        } else if (currentLocal > cloudScore) {
            void window.GamePlatform.saveBestScore(currentLocal);
            if (window.GameLeaderboards) {
                window.GameLeaderboards.submit('endless', currentLocal);
            }
        }
    } catch (e) {
        console.warn('Error syncing cloud best score:', e);
    }
}

function handleGlobalKeydown(event) {
    if (event.key === 'Escape' && settingsModal.classList.contains('show')) {
        closeSettingsModal();
    }
}

// Единая точка запуска партии для обоих режимов.
//   options.mode  — 'endless' | 'adventure' (по умолчанию классика)
//   options.level — подготовленный setup уровня из adventure.js
async function startGame(options) {
    const opts = options || {};
    const nextMode = opts.mode === MODE_ADVENTURE ? MODE_ADVENTURE : MODE_ENDLESS;

    splashOverlay.classList.add('hidden');
    closeSettingsModal();
    setInputLocked(false);
    gameMode = nextMode;
    pendingLevelSetup = opts.level || null;
    hasGameStarted = true;
    trackEvent('game_start', { best: bestScore, mode: nextMode });
    audioManager.beginGameSession().catch(() => { });
    haptic.confirm();
    // Дожидаемся готовности Pixi (init стартовал ещё на загрузке — обычно уже резолвнут),
    // чтобы первый рендер доски точно знал, доступен ли WebGL-рендер, и не мигал.
    if (RENDERER_PREFERENCE === 'pixi' && window.pixiRenderer && window.pixiRenderer.ready) {
        try { await window.pixiRenderer.ready; } catch (e) { /* фолбэк на DOM */ }
    }
    initGame();
    syncGameplayState();
    void initializePlatformLifecycle();

    // Хост-события и облачный рекорд не должны задерживать старт партии — ждём готовность
    // платформы в фоне. whenReady() уже включает init хоста, поэтому ретраи по таймеру,
    // которые здесь стояли раньше, больше не нужны.
    void (async () => {
        if (!window.GamePlatform) {
            return;
        }

        await window.GamePlatform.whenReady();
        window.GamePlatform.reportEvent('game_start');
        syncGameplayState();

        if (nextMode === MODE_ENDLESS) {
            await syncBestScoreWithPlatform();
        }
    })();
}

// Возврат на стартовый экран выбора режима (из настроек или с карты приключения).
function returnToModeSelect() {
    clearPendingRefill();
    clearPendingGameOver();
    if (isDragging) cancelDrag();
    closeSettingsModal();
    setHammerArmed(false);
    setInputLocked(false);
    // Вызываем напрямую, а не через adventureHook: карту нужно закрыть и тогда,
    // когда режим уже переключён обратно на классику.
    if (window.Adventure && typeof window.Adventure.closeUi === 'function') {
        window.Adventure.closeUi();
    }
    gameOverScreen.classList.remove('show');
    secondChanceModal.classList.remove('show');
    gameContainer.classList.remove('game-over-transition');
    hasGameStarted = false;
    gameMode = MODE_ENDLESS;
    if (document.body) document.body.classList.remove('mode-adventure');
    // За полупрозрачным сплешем не должна светиться доска прошлого уровня.
    pendingLevelSetup = null;
    applyLevelSetup(null);
    trayPieces = [null, null, null];
    score = 0;
    displayedScore = 0;
    updateScore();
    renderBoard();
    renderTray();
    splashOverlay.classList.remove('hidden');
    setSplashPlayEnabled(isSplashPlayEnabled);
    refreshSplashSubtitles();
    updateSplashPlayButtonPosition();
    syncGameplayState();
}

// Start game only from the splash mode buttons.
splashOverlay.addEventListener('pointerdown', (e) => {
    if (hasGameStarted || !isSplashPlayEnabled) {
        return;
    }

    if (splashPlayBtn && splashPlayBtn.contains(e.target)) {
        startGame({ mode: MODE_ENDLESS });
        return;
    }

    if (splashAdventureBtn && splashAdventureBtn.contains(e.target)) {
        if (window.Adventure && typeof window.Adventure.openMap === 'function') {
            splashOverlay.classList.add('hidden');
            window.Adventure.openMap();
        } else {
            // levels.js/adventure.js не загрузились — не оставляем игрока без игры.
            startGame({ mode: MODE_ENDLESS });
        }
        return;
    }

    if (splashLeaderboardBtn && splashLeaderboardBtn.contains(e.target)) {
        if (window.GameLeaderboards && typeof window.GameLeaderboards.openUi === 'function') {
            window.GameLeaderboards.openUi('endless');
        }
    }
});

// Решает, показывать ли interstitial при нажатии «Заново».
// 'skip-revive' — игрок возродился за rewarded в этой сессии: показ гарантированно пропускается.
// 'show'        — выполнены все условия (каждый N-й рестарт + долгая партия + интервал).
// 'none'        — просто запускаем новую игру.
function decideInterstitial(sessionDurationMs) {
    if (skipNextInterstitial) return 'skip-revive';
    if (!window.GameAds || !window.GameAds.hasProvider()) return 'none';
    if (gamesSinceInterstitial < INTERSTITIAL_EVERY_N_GAMES) return 'none';
    if (sessionDurationMs < INTERSTITIAL_MIN_SESSION_MS) return 'none';
    if (lastInterstitialAtMs && (Date.now() - lastInterstitialAtMs) < INTERSTITIAL_MIN_INTERVAL_MS) {
        return 'none';
    }
    return 'show';
}

function showInterstitialThen(next) {
    const run = typeof next === 'function' ? next : () => { };

    if (isInterstitialInFlight) {
        // Показ уже идёт — не глотаем переход, просто продолжаем без второй рекламы.
        run();
        return;
    }

    isInterstitialInFlight = true;
    audioManager.suspend().catch(() => { });

    let done = false;
    let fallbackTimeoutId = 0;
    const proceed = (wasShown) => {
        if (done) return;
        done = true;
        if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);
        isInterstitialInFlight = false;

        if (wasShown) {
            // Реклама реально показана — сбрасываем счётчик и таймер интервала.
            gamesSinceInterstitial = 0;
            lastInterstitialAtMs = Date.now();
        }
        // startGame() сам перезапустит аудио-сессию через beginGameSession().
        run();
    };

    window.GameAds.showInterstitial({
        onOpen: () => { syncGameplayState(); },
        onError: () => { /* onClose всё равно сработает и продолжит игру */ },
        onClose: (wasShown) => { proceed(wasShown); },
    });

    // Страховка на случай, если провайдер вообще не вызовет колбэки. Таймаут намеренно
    // длиннее любой реальной рекламы: прежние 8 секунд срабатывали ПОСЕРЕДИНЕ ещё идущего
    // ролика — игра рестартовала за ним, показ не засчитывался, а следующий рестарт ловил
    // ещё один interstitial.
    fallbackTimeoutId = setTimeout(() => proceed(false), INTERSTITIAL_FALLBACK_MS);
}

// Общий шлюз межстраничной рекламы для обоих режимов: классика зовёт его на «Заново»,
// приключение — на переходе между уровнями. Частотные лимиты и «не подряд с rewarded»
// считаются в одном месте, поэтому режимы не могут перекрутить друг другу воронку.
function maybeShowInterstitial(sessionDurationMs, next) {
    const run = typeof next === 'function' ? next : () => { };
    gamesSinceInterstitial++;

    const decision = decideInterstitial(sessionDurationMs || 0);

    if (decision === 'skip-revive') {
        skipNextInterstitial = false;
        gamesSinceInterstitial = 0;
        run();
        return;
    }

    if (decision === 'show') {
        showInterstitialThen(run);
        return;
    }

    run();
}

function handleRestartClick() {
    // Партия завершена и игрок начинает новую сессию — экран Game Over уже отыграл роль
    // психологического буфера, поэтому именно здесь принимаем решение о рекламе.
    const sessionDurationMs = sessionStartedAtMs ? (Date.now() - sessionStartedAtMs) : 0;
    maybeShowInterstitial(sessionDurationMs, () => startGame({ mode: MODE_ENDLESS }));
}

restartBtn.addEventListener('click', handleRestartClick);

if (secondChanceAdBtn) {
    secondChanceAdBtn.addEventListener('click', () => {
        if (!window.GameAds || !window.GameAds.hasProvider()) {
            // Фолбэк, если рекламных провайдеров нет (браузер или APK без :wrapper-ads):
            // просто выдаём второй шанс. Прежний фолбэк открывал внешний сайт, а это внутри
            // APK выбрасывает игрока в браузер, поэтому он убран.
            applySecondChanceReward();
            return;
        }

        window.GameAds.showRewarded({
            onOpen: () => {
                audioManager.suspend().catch(() => { });
                syncGameplayState();
            },
            onReward: () => {
                applySecondChanceReward();
            },
            onClose: () => {
                if (!isGameplayPausedBySdk) {
                    audioManager.resume().catch(() => { });
                }

                // Если награда не получена (отказ/ошибка), показываем Game Over —
                // он же служит буфером перед возможным interstitial при «Заново».
                if (!hasUsedSecondChance) {
                    pendingRewardShapes = null;
                    secondChanceModal.classList.remove('show');
                    finalizeBestScore();
                    gameOverScoreEl.textContent = formatNumber(score);
                    revealGameOverScreen();
                } else {
                    syncGameplayState();
                }
            }
        });
    });
}

if (secondChanceSkipBtn) {
    secondChanceSkipBtn.addEventListener('click', () => {
        trackEvent('second_chance_declined', { score: score });
        pendingRewardShapes = null;
        secondChanceModal.classList.remove('show');
        finalizeBestScore();
        gameOverScoreEl.textContent = formatNumber(score);
        revealGameOverScreen();
    });
}

function applySecondChanceReward() {
    trackEvent('second_chance_taken', { score: score });
    hasUsedSecondChance = true;
    // Игрок посмотрел rewarded и возродился: гарантированно пропускаем следующий
    // interstitial и сбрасываем счётчик смертей (idle-баланс «реклама не подряд»).
    skipNextInterstitial = true;
    gamesSinceInterstitial = 0;
    secondChanceModal.classList.remove('show');
    isGameOverSequenceActive = false;
    gameContainer.classList.remove('game-over-transition');

    if (pendingRewardShapes) {
        for (let i = 0; i < 3; i++) {
            trayPieces[i] = pendingRewardShapes[i];
        }
    }
    pendingRewardShapes = null;

    renderTray();
    syncGameplayState();
}

settingsBtn.addEventListener('click', openSettingsModal);
settingsCloseBtn.addEventListener('click', closeSettingsModal);
musicToggle.addEventListener('change', event => {
    setSoundPreference(Boolean(event.target.checked));
});
document.addEventListener('keydown', handleGlobalKeydown);

if (menuBtn) {
    menuBtn.addEventListener('click', returnToModeSelect);
}

if (settingsLeaderboardBtn) {
    settingsLeaderboardBtn.addEventListener('click', () => {
        closeSettingsModal();
        if (window.GameLeaderboards && typeof window.GameLeaderboards.openUi === 'function') {
            window.GameLeaderboards.openUi(isAdventureMode() ? 'adventure' : 'endless');
        }
    });
}

// Молоток: пока бустер «взведён», тап по ячейке уничтожает её содержимое.
// Обычный драг в это время заблокирован (см. startDrag).
if (boardEl) {
    boardEl.addEventListener('pointerdown', event => {
        if (!isHammerArmed || isAnimating || isInputLocked) return;

        const cellEl = event.target && event.target.closest ? event.target.closest('.cell') : null;
        if (!cellEl || !cellEl.id) return;

        const parts = cellEl.id.split('-');
        const r = Number(parts[1]);
        const c = Number(parts[2]);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;

        event.preventDefault();

        const tally = hammerCell(r, c);
        if (!tally) {
            // Пустая клетка — бустер не тратим.
            haptic.error();
            return;
        }

        adventureHook('onHammerUsed', { r: r, c: c, collected: tally });
    }, { passive: false });
}

document.addEventListener('pointermove', function (e) {
    if (isDragging) e.preventDefault();
}, { passive: false });

window.addEventListener('resize', refreshLayoutMetrics);
window.addEventListener('orientationchange', refreshLayoutMetrics);
window.addEventListener('load', refreshLayoutMetrics);
requestAnimationFrame(refreshLayoutMetrics);

// Энергосбережение: останавливаем тикер Pixi, когда вкладка/окно неактивны.
window.addEventListener('blur', () => {
    if (window.pixiRenderer && typeof window.pixiRenderer.stop === 'function') {
        window.pixiRenderer.stop();
    }
});
window.addEventListener('focus', () => {
    if (usePixi() && typeof window.pixiRenderer.start === 'function') {
        window.pixiRenderer.start();
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (window.pixiRenderer && typeof window.pixiRenderer.stop === 'function') {
            window.pixiRenderer.stop();
        }
    } else if (usePixi() && typeof window.pixiRenderer.start === 'function') {
        window.pixiRenderer.start();
    }
});

const debugGameOverBtn = document.getElementById('debug-gameover-btn');
if (debugGameOverBtn && isLocalDebugEnabled) {
    debugGameOverBtn.style.display = 'block';
    debugGameOverBtn.addEventListener('click', () => {
        if (!hasUsedSecondChance) {
            pendingRewardShapes = generateRewardShapes();
            renderRewardShapes(pendingRewardShapes);
            showSecondChance();
        } else {
            showGameOver();
        }
    });
}

const debugLangBtn = document.getElementById('debug-lang-btn');
if (debugLangBtn && isLocalDebugEnabled) {
    const SUPPORTED_LANGUAGES = Object.keys(I18N);
    const updateDebugLangLabel = () => {
        debugLangBtn.textContent = `Lang: ${currentLanguage.toUpperCase()}`;
    };
    debugLangBtn.style.display = 'block';
    updateDebugLangLabel();
    debugLangBtn.addEventListener('click', () => {
        const currentIndex = SUPPORTED_LANGUAGES.indexOf(currentLanguage);
        const nextLang = SUPPORTED_LANGUAGES[(currentIndex + 1) % SUPPORTED_LANGUAGES.length];
        applyTranslations(nextLang);
        try {
            window.localStorage.setItem(DEBUG_LANGUAGE_KEY, currentLanguage);
        } catch {
            // ignore storage errors
        }
        updateDebugLangLabel();
    });
}

window.initGame = initGame;
window.startGame = startGame;

// --- КОНТРАКТ ЯДРА ДЛЯ adventure.js ---
// Ядро не знает ни про цели, ни про жизни, ни про прогресс: приключение управляет
// партией только через эти команды и получает события через window.Adventure.
window.GameCore = {
    MODE_ENDLESS: MODE_ENDLESS,
    MODE_ADVENTURE: MODE_ADVENTURE,
    BOARD_SIZE: BOARD_SIZE,
    SHAPES: SHAPES_DATA,
    COLORS: COLORS,

    // Управление партией
    startGame: startGame,
    returnToModeSelect: returnToModeSelect,
    getMode: () => gameMode,
    getScore: () => score,
    getComboStreak: () => comboStreak,
    isBusy: () => isAnimating || isDragging,

    // Ввод и бустеры
    setInputLocked: setInputLocked,
    setHammerArmed: setHammerArmed,
    isHammerArmed: () => isHammerArmed,
    reshuffleTray: reshuffleTray,
    addBombTurns: addBombTurns,

    // Состояние доски
    countRemainingTargets: countRemainingTargets,
    hasAnyValidMove: hasAnyValidMove,

    // Реклама и аналитика (лимиты частоты общие с классикой)
    maybeShowInterstitial: maybeShowInterstitial,
    getSessionDurationMs: () => (sessionStartedAtMs ? Date.now() - sessionStartedAtMs : 0),
    markRewardedWatched: () => {
        // Игрок только что смотрел rewarded — следующий interstitial пропускаем.
        skipNextInterstitial = true;
        gamesSinceInterstitial = 0;
    },
    trackEvent: trackEvent,

    // Утилиты представления
    getLanguage: () => currentLanguage,
    formatNumber: formatNumber,
    createShapeHTML: createShapeHTML,
    playSound: playSound,
    haptic: haptic,
    refreshSplashSubtitles: refreshSplashSubtitles
};
