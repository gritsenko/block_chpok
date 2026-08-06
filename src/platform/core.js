/**
 * platform/core.js — host-agnostic core of the game's platform layer.
 *
 * Defines the two public facades and NOTHING host-specific. Every host lives in its own
 * sibling file and registers itself here; the build ships only the adapters a given
 * target needs, and the concatenated result is still a single `platform.js`.
 *
 * Public contract (see docs/GAME_ADS_API.md):
 *   window.GameAds       — ads + portal progress funnel + player context
 *   window.GamePlatform  — readiness, language, lifecycle, cloud best-score, host events
 *
 * Registration contract — window.GamePlatformRegistry.register(adapter):
 *
 *   name        string   short host id, reported as-is by GameAds.provider()
 *   priority    number   lower resolves first; ties break on registration order
 *   available   ()->bool CAN THIS HOST SERVE AN AD RIGHT NOW. Called on every request,
 *                        never cached: hosts appear after us (their <script> tags are
 *                        injected later) and can disappear (no parent player).
 *   showRewarded     (cb)->void      cb: { onOpen, onReward, onError, onClose }
 *   showInterstitial (cb)->void      cb: { onOpen, onError, onClose }
 *   isRewardedReady     ()->bool
 *   isInterstitialReady ()->bool
 *   showBanner / hideBanner / isBannerVisible  ()->bool   optional
 *   eventSink   ()->{ logEvent, levelComplete } | null    optional, progress funnel
 *   context     ()->{ getUserId, isRewardMode, getGameId } | null   optional
 *   nativeShell ()->bool     optional; true only under a REAL native shell
 *   host        ()->object|null  optional; the GamePlatform lifecycle implementation
 *   boot        (done)->void optional; async bootstrap. Called only when no adapter was
 *                            available at load. MUST call done(answered) exactly once —
 *                            whenReady() is what gates the splash Play button, so a boot
 *                            that never finishes leaves the game unplayable.
 *
 * Callback contract, identical for every host:
 *   • onClose ALWAYS fires exactly once and last (even on errors / with no host at all).
 *   • onReward fires only when the user earned the reward.
 *   • onError fires for status in { error, not_ready, disabled, busy, unavailable }.
 *     For interstitials 'dismissed' is the SUCCESS path — onClose without onError.
 */
(function () {
    'use strict';

    const adapters = [];

    let resolveReady;
    let readySettled = false;
    const readyPromise = new Promise(resolve => { resolveReady = resolve; });

    function settleReady(answered) {
        if (readySettled) return;
        readySettled = true;
        resolveReady(!!answered);
    }

    function byPriority(a, b) {
        return (a.priority || 0) - (b.priority || 0);
    }

    function register(adapter) {
        if (!adapter || typeof adapter.available !== 'function') return;
        adapters.push(adapter);
        adapters.sort(byPriority);
    }

    // Resolution order is load-bearing, not cosmetic: with a higher-priority host present
    // we must never touch a lower-priority one, because some of them take ownership of
    // shared globals (a native callback hook) the moment they are built.
    function pick(capability) {
        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a[capability] !== 'function') continue;
            if (!a.available()) continue;
            return a;
        }
        return null;
    }

    function pickAny(capability) {
        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a[capability] === 'function') {
                const value = a[capability]();
                if (value) return value;
            }
        }
        return null;
    }

    function hasProvider() {
        for (let i = 0; i < adapters.length; i++) {
            if (adapters[i].available()) return true;
        }
        return false;
    }

    function provider() {
        for (let i = 0; i < adapters.length; i++) {
            if (adapters[i].available()) return adapters[i].name || 'unknown';
        }
        return 'none';
    }

    function safe(fn, arg) {
        if (typeof fn !== 'function') return;
        try { fn(arg); } catch (e) { console.warn('[platform] callback threw', e); }
    }

    // Wraps the caller's callbacks so onClose fires exactly once and last, no matter how
    // many times a host calls back or in what order.
    function guard(callbacks) {
        const cb = callbacks || {};
        let finished = false;
        let errored = false;

        return {
            onOpen: () => safe(cb.onOpen),
            onReward: () => safe(cb.onReward),
            onError: (result) => {
                errored = true;
                safe(cb.onError, result || { status: 'error' });
            },
            close: (wasShown) => {
                if (finished) return;
                finished = true;
                safe(cb.onClose, wasShown);
            },
            errored: () => errored,
        };
    }

    function showRewarded(callbacks) {
        const g = guard(callbacks);
        const a = pick('showRewarded');

        if (!a) {
            g.onError({ status: 'unavailable' });
            g.close(false);
            return 'none';
        }

        a.showRewarded({
            onOpen: g.onOpen,
            onReward: g.onReward,
            onError: g.onError,
            onClose: (wasShown) => g.close(g.errored() ? false : wasShown !== false),
        });

        return a.name || 'unknown';
    }

    function showInterstitial(callbacks) {
        const g = guard(callbacks);
        const a = pick('showInterstitial');

        if (!a) {
            g.onError({ status: 'unavailable' });
            g.close(false);
            return 'none';
        }

        a.showInterstitial({
            onOpen: g.onOpen,
            onError: g.onError,
            onClose: (wasShown) => g.close(g.errored() ? false : wasShown !== false),
        });

        return a.name || 'unknown';
    }

    function isRewardedReady() {
        const a = pick('isRewardedReady');
        if (!a) return false;
        try { return !!a.isRewardedReady(); } catch (e) { return false; }
    }

    function isInterstitialReady() {
        const a = pick('isInterstitialReady');
        if (!a) return false;
        try { return !!a.isInterstitialReady(); } catch (e) { return false; }
    }

    function showBanner() {
        const a = pick('showBanner');
        if (!a) return false;
        try { return !!a.showBanner(); } catch (e) { return false; }
    }

    function hideBanner() {
        const a = pick('hideBanner');
        if (!a) return false;
        try { return !!a.hideBanner(); } catch (e) { return false; }
    }

    function isBannerVisible() {
        const a = pick('isBannerVisible');
        if (!a) return false;
        try { return !!a.isBannerVisible(); } catch (e) { return false; }
    }

    // -----------------------------------------------------------------------
    // Progress funnel + custom events. Answered by whichever adapter owns a sink;
    // where none does, the call is a silent no-op so call sites need no wrappers.
    //
    // Event-name rules are enforced by the portal server-side: [a-z0-9_]{1,64}, never
    // generated dynamically (unique names are capped per project), and `level_complete`
    // plus anything `ad_*` are reserved — the portal mints those itself.
    // -----------------------------------------------------------------------
    function logEvent(name, params) {
        const sink = pickAny('eventSink');
        if (!sink || typeof sink.logEvent !== 'function') return false;
        try {
            sink.logEvent(name, params);
            return true;
        } catch (e) {
            console.warn('[platform] logEvent failed', e);
            return false;
        }
    }

    function levelComplete(level, params) {
        const sink = pickAny('eventSink');
        if (!sink || typeof sink.levelComplete !== 'function') return false;
        try {
            sink.levelComplete(level, params);
            return true;
        } catch (e) {
            console.warn('[platform] levelComplete failed', e);
            return false;
        }
    }

    // Player context, for UX decisions and storage namespacing. All three degrade to a
    // "no host" answer rather than throwing, so game code can call them unguarded.
    function contextValue(method) {
        const ctx = pickAny('context');
        if (!ctx || typeof ctx[method] !== 'function') return null;
        try { return ctx[method]() || null; } catch (e) { return null; }
    }

    function getUserId() { return contextValue('getUserId'); }
    function getGameId() { return contextValue('getGameId'); }

    function isRewardMode() {
        const ctx = pickAny('context');
        if (!ctx || typeof ctx.isRewardMode !== 'function') return false;
        try { return !!ctx.isRewardMode(); } catch (e) { return false; }
    }

    // -----------------------------------------------------------------------
    // GamePlatform — everything a host offers that is NOT an ad. Every method answers
    // on every build: no host means a no-op, false, or null — never a throw, never a hang.
    // -----------------------------------------------------------------------
    function hostImpl() {
        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a.host !== 'function') continue;
            const h = a.host();
            if (h) return h;
        }
        return null;
    }

    function hostCall(method, fallback, arg) {
        const h = hostImpl();
        if (!h || typeof h[method] !== 'function') return fallback;
        try { return h[method](arg); } catch (e) { return fallback; }
    }

    function langFromUrl() {
        try {
            return new URLSearchParams(window.location.search).get('lang') || null;
        } catch (e) {
            return null;
        }
    }

    // Synchronous by contract: game code reads the language while its own script is still
    // evaluating, long before any SDK could have answered. The host refines it later,
    // after whenReady().
    function getLanguage() {
        const fromUrl = langFromUrl();
        if (fromUrl) return fromUrl;

        const fromHost = hostCall('getLanguage', null);
        if (fromHost) return fromHost;

        return (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en';
    }

    function gameReady() {
        return !!hostCall('gameReady', true);
    }

    // start/stopGameplay report whether a host actually took the call, so callers can track
    // "is the indicator on" without a separate availability probe.
    function startGameplay() { return !!hostCall('startGameplay', false); }
    function stopGameplay() { return !!hostCall('stopGameplay', false); }

    function onPause(listener) { return hostCall('onPause', function () {}, listener) || function () {}; }
    function onResume(listener) { return hostCall('onResume', function () {}, listener) || function () {}; }
    function isPaused() { return !!hostCall('isPaused', false); }

    function saveBestScore(score) {
        const h = hostImpl();
        if (!h || typeof h.saveBestScore !== 'function') return Promise.resolve(false);
        try { return Promise.resolve(h.saveBestScore(score)); } catch (e) { return Promise.resolve(false); }
    }

    // null means "this host has no cloud store" — distinct from 0, which is a real stored
    // score. Callers must not write anything back on null.
    function getBestScore() {
        const h = hostImpl();
        if (!h || typeof h.getBestScore !== 'function') return Promise.resolve(null);
        try {
            return Promise.resolve(h.getBestScore()).then(
                (value) => (typeof value === 'number' ? value : null),
                () => null
            );
        } catch (e) {
            return Promise.resolve(null);
        }
    }

    // Events the HOST itself requires, keyed by a neutral name each host maps to its own
    // call. Deliberately separate from logEvent/levelComplete above, which feed the portal
    // funnel: the two fire at different moments, and one host's mandatory event name is
    // another host's reserved word.
    function reportEvent(name, params) {
        return !!hostCall('reportEvent', false, { name: name, params: params || {} });
    }

    function isNativeShell() {
        for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i];
            if (typeof a.nativeShell === 'function' && a.nativeShell()) return true;
        }
        return false;
    }

    window.GamePlatformRegistry = { register: register };

    window.GamePlatform = {
        whenReady: function () { return readyPromise; },
        getLanguage: getLanguage,
        gameReady: gameReady,
        startGameplay: startGameplay,
        stopGameplay: stopGameplay,
        onPause: onPause,
        onResume: onResume,
        isPaused: isPaused,
        saveBestScore: saveBestScore,
        getBestScore: getBestScore,
        reportEvent: reportEvent,
        isNativeShell: isNativeShell,
    };

    window.GameAds = {
        get platform() { return isNativeShell() || provider() === 'sim' ? 'native' : 'web'; },
        provider: provider,
        hasProvider: hasProvider,
        showInterstitial: showInterstitial,
        showRewarded: showRewarded,
        isInterstitialReady: isInterstitialReady,
        isRewardedReady: isRewardedReady,
        showBanner: showBanner,
        hideBanner: hideBanner,
        isBannerVisible: isBannerVisible,
        levelComplete: levelComplete,
        logEvent: logEvent,
        getUserId: getUserId,
        isRewardMode: isRewardMode,
        getGameId: getGameId,
    };

    // Boot runs after every adapter file has been evaluated. An adapter that is already
    // available at load wins outright and nothing is fetched — that matters where a
    // would-be bootstrapper's SDK is not served at all: fetching it would 404 and stall
    // whenReady(), which gates the splash Play button.
    function boot() {
        const host = provider();

        if (host !== 'none') {
            settleReady(false);
            console.log('[platform] ' + host + ' ready at load — host SDK fetch skipped.');
            return;
        }

        for (let i = 0; i < adapters.length; i++) {
            if (typeof adapters[i].boot === 'function') {
                adapters[i].boot(settleReady);
                return;
            }
        }

        settleReady(false);
    }

    // Adapter files are plain <script> tags after this one, so they have all registered by
    // the time the current task yields. A microtask is the earliest safe moment to look.
    Promise.resolve().then(() => {
        boot();
        console.log('[platform] facades ready (provider=' + provider() + ', adapters=' + adapters.length + ').');
    });
})();
