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
;
/**
 * platform/gameads.js — reward-hub / native APK shell adapter.
 *
 * One family of hosts, resolved in this order on every call:
 *   window.AdsManager — rnd-lab's ads-bridge.js (RewardHub → AppLovin MAX). Preferred,
 *                       because that path also carries progress events, custom events
 *                       and ILRD attribution.
 *   window.AdsBridge  — the shell's raw @JavascriptInterface, wrapped here into the
 *                       uniform adapter shape (this used to be a separate ads-bridge.js).
 *                       The fallback for a shell that ships no SDK; both paths end in the
 *                       same ad-network call.
 *
 * Ads only — the shell has no lifecycle / storage half, so no host().
 *
 * Ships in the gameads and web targets.
 */
(function () {
    'use strict';

    // The raw @JavascriptInterface installed by the APK shell, if any. Read at load time
    // because the shell injects it into the page before any of our scripts run — unlike the
    // SDK objects below, which arrive later.
    const rawBridge = (typeof window !== 'undefined') ? window.AdsBridge : null;
    const hasRawBridge = !!(rawBridge && typeof rawBridge.showRewarded === 'function');

    // The wrapped raw-native adapter. Stays null until nativeAdapter() builds it on first
    // use — see the note above nativeAdapter() for why this must not happen at load time.
    let adapter = null;
    let rawAdapterResolved = false;

    // -----------------------------------------------------------------------
    // Native adapter — wraps window.AdsBridge into a uniform shape.
    // -----------------------------------------------------------------------
    function buildNativeAdapter() {
        if (!rawBridge || typeof rawBridge.showRewarded !== 'function') return null;

        const pending = new Map();
        let nextId = 1;

        // Kotlin's AdsBridge.dispatchCallback resolves async results by invoking
        // window.__adsCallback. MUST live on window — the native side calls it
        // via evaluateJavascript and can't see our closure.
        window.__adsCallback = function (callbackId, result) {
            const handler = pending.get(callbackId);
            if (!handler) {
                console.warn('[platform] no handler for callbackId', callbackId);
                return;
            }
            pending.delete(callbackId);
            handler(result || { status: 'error' });
        };

        function showRewarded(cb) {
            const id = 'ad_' + (nextId++);
            pending.set(id, (result) => {
                const status = result.status;
                if (status === 'rewarded') {
                    cb.onReward && cb.onReward();
                } else if (status === 'error' || status === 'disabled' ||
                           status === 'not_ready' || status === 'busy') {
                    cb.onError && cb.onError(result);
                }
                cb.onClose && cb.onClose();
            });
            try {
                cb.onOpen && cb.onOpen();
                rawBridge.showRewarded(id);
            } catch (e) {
                pending.delete(id);
                console.error('[platform] native showRewarded threw', e);
                cb.onError && cb.onError({ status: 'error', error: String(e) });
                cb.onClose && cb.onClose();
            }
        }

        function showInterstitial(cb) {
            if (typeof rawBridge.showInterstitial !== 'function') {
                cb.onError && cb.onError({ status: 'unavailable' });
                cb.onClose && cb.onClose();
                return;
            }
            const id = 'ad_' + (nextId++);
            pending.set(id, (result) => {
                const status = result.status;
                // 'dismissed' = success for interstitials; no onError on that path.
                if (status === 'error' || status === 'disabled' ||
                    status === 'not_ready' || status === 'busy') {
                    cb.onError && cb.onError(result);
                }
                cb.onClose && cb.onClose();
            });
            try {
                cb.onOpen && cb.onOpen();
                rawBridge.showInterstitial(id);
            } catch (e) {
                pending.delete(id);
                console.error('[platform] native showInterstitial threw', e);
                cb.onError && cb.onError({ status: 'error', error: String(e) });
                cb.onClose && cb.onClose();
            }
        }

        return {
            showRewarded: showRewarded,
            showInterstitial: showInterstitial,
            isRewardedReady() {
                if (typeof rawBridge.isRewardedReady !== 'function') return false;
                try { return !!rawBridge.isRewardedReady(); } catch (e) { return false; }
            },
            isInterstitialReady() {
                if (typeof rawBridge.isInterstitialReady !== 'function') return false;
                try { return !!rawBridge.isInterstitialReady(); } catch (e) { return false; }
            },
            showBanner() {
                if (typeof rawBridge.showBanner !== 'function') return false;
                try { rawBridge.showBanner(); return true; } catch (e) { return false; }
            },
            hideBanner() {
                if (typeof rawBridge.hideBanner !== 'function') return false;
                try { rawBridge.hideBanner(); return true; } catch (e) { return false; }
            },
            isBannerVisible() {
                if (typeof rawBridge.isBannerVisible !== 'function') return false;
                try { return !!rawBridge.isBannerVisible(); } catch (e) { return false; }
            },
        };
    }

    // -----------------------------------------------------------------------
    // Host facades we do NOT create: window.AdsManager (rnd-lab ads-bridge.js) and
    // window.Jam (jam-compat.js in an rnd-lab APK). Both are resolved LAZILY, on every
    // call, for two reasons:
    //   • rnd-lab's build_service inserts their <script> tags before </head>, i.e.
    //     AFTER this file — neither object exists while we are being evaluated;
    //   • ads-bridge.js installs its own window.__adsCallback. Building our raw
    //     native adapter eagerly would let that overwrite ours, and every rewarded
    //     show would then hang with no onClose. So the raw adapter is built on
    //     first use, and only once we know no higher-level facade answered.
    // -----------------------------------------------------------------------
    function hubAdsManager() {
        const m = window.AdsManager;
        if (!m || !m.available || typeof m.showRewardedVideo !== 'function') return null;
        return m;
    }

    // Built once, on first use. Every entry point below asks the hub first, and the registry
    // only reaches this adapter after the higher-priority ones declined — together that is
    // what keeps "no eager build" true.
    function nativeAdapter() {
        if (!rawAdapterResolved) {
            rawAdapterResolved = true;
            adapter = buildNativeAdapter();
        }
        return adapter;
    }

    // window.Jam counts as a sink here too: inside an APK, jam-compat.js installs it on top
    // of RewardHub and both speak the same game-bridge contract. So this file must answer for
    // it as well — a build that ships no portal adapter still has to feed the funnel.
    function jamFacade() {
        const j = window.Jam || window.jam;
        if (!j || typeof j.showRewarded !== 'function') return null;
        return j.available === false ? null : j;
    }

    window.GamePlatformRegistry.register({
        name: 'gameads',
        priority: 20,

        // We intentionally do NOT key `available` off rawBridge.isAdsEnabled():
        // some shells don't expose it at all, and the native side already returns
        // 'disabled' through the callback when ads are off. Keying off enabled
        // here would hide the second-chance offer even when ads work fine.
        available() {
            return !!(hubAdsManager() || hasRawBridge);
        },

        // onClose is forwarded with NO argument on purpose: neither host reports a "was it
        // shown" flag, so the outcome is decided purely by whether onError fired.
        showRewarded(cb) {
            const hub = hubAdsManager();
            if (hub) {
                hub.showRewardedVideo({
                    onOpen: cb.onOpen,
                    onReward: cb.onReward,
                    onError: cb.onError,
                    onClose: function () { cb.onClose(); },
                });
                return;
            }
            nativeAdapter().showRewarded({
                onOpen: cb.onOpen,
                onReward: cb.onReward,
                onError: cb.onError,
                onClose: function () { cb.onClose(); },
            });
        },

        showInterstitial(cb) {
            const hub = hubAdsManager();
            if (hub) {
                hub.showInterstitial({
                    onOpen: cb.onOpen,
                    onError: cb.onError,
                    onClose: function () { cb.onClose(); },
                });
                return;
            }
            nativeAdapter().showInterstitial({
                onOpen: cb.onOpen,
                onError: cb.onError,
                onClose: function () { cb.onClose(); },
            });
        },

        isRewardedReady() {
            const hub = hubAdsManager();
            if (hub) {
                try { return !!hub.isRewardedReady(); } catch (e) { return false; }
            }
            const native = nativeAdapter();
            return !!(native && native.isRewardedReady());
        },

        isInterstitialReady() {
            const hub = hubAdsManager();
            if (hub) {
                try { return !!hub.isInterstitialReady(); } catch (e) { return false; }
            }
            const native = nativeAdapter();
            return !!(native && native.isInterstitialReady());
        },

        // A hub without banner methods falls through to the raw bridge, which is the layer
        // that can actually draw one in a native shell.
        showBanner() {
            const hub = hubAdsManager();
            if (hub && typeof hub.showBanner === 'function') {
                try { hub.showBanner(); return true; } catch (e) { return false; }
            }
            const native = nativeAdapter();
            return !!(native && native.showBanner());
        },

        hideBanner() {
            const hub = hubAdsManager();
            if (hub && typeof hub.hideBanner === 'function') {
                try { hub.hideBanner(); return true; } catch (e) { return false; }
            }
            const native = nativeAdapter();
            return !!(native && native.hideBanner());
        },

        isBannerVisible() {
            const hub = hubAdsManager();
            if (hub && typeof hub.isBannerVisible === 'function') {
                try { return !!hub.isBannerVisible(); } catch (e) { return false; }
            }
            const native = nativeAdapter();
            return !!(native && native.isBannerVisible());
        },

        eventSink() {
            const j = jamFacade();
            if (j && typeof j.logEvent === 'function') return j;
            const rh = window.RewardHub;
            return (rh && typeof rh.logEvent === 'function') ? rh : null;
        },

        context() {
            return jamFacade() || window.RewardHub || null;
        },

        // Synchronous, and deliberately a plain read of the shell's own object: game.js calls
        // this while its own script is still evaluating, to pick the DOM renderer over WebGL.
        // It must not build the native adapter (that would take ownership of
        // window.__adsCallback away from an SDK that has not loaded yet) and must not count a
        // simulated host, which is not a real shell.
        nativeShell() {
            return hasRawBridge;
        },
    });
})();
;
/**
 * platform/jam.js — MY.GAMES JAM portal adapter (jam.my.games/docs/game-bridge-contract.md).
 *
 * Nothing is loaded from here: the portal serves its own jam-sdk.js (with a mock ad player)
 * and installs window.Jam itself. That object is resolved LAZILY, on every call, because the
 * portal inserts its <script> tag before </head> — i.e. AFTER this file — so window.Jam does
 * not exist yet while we are being evaluated.
 *
 * priority 10 puts this host ahead of every other ad path on purpose: several of them end up
 * in the very same ad-network call, but only this one also carries the progress funnel,
 * custom events and ILRD attribution.
 *
 * Ads only — the portal contract has no lifecycle, storage or language half, so no host().
 *
 * Ships in the jam and web targets.
 */
(function () {
    'use strict';

    function jamBridge() {
        const j = window.Jam || window.jam;
        if (!j || typeof j.showRewarded !== 'function') return null;
        // jam-sdk reports available=false with no portal parent to talk to, and the APK
        // compat shim mirrors whatever its underlying ad hub reports. Either way the object
        // exists but has nothing behind it: no host, no ads.
        return j.available === false ? null : j;
    }

    window.GamePlatformRegistry.register({
        name: 'jam',
        priority: 10,

        available() {
            return !!jamBridge();
        },

        // onClose is forwarded with NO argument on purpose: the JAM contract carries no
        // "was it shown" flag, so the outcome is decided purely by whether onError fired.
        showRewarded(cb) {
            jamBridge().showRewarded({
                onOpen: cb.onOpen,
                onReward: cb.onReward,
                onError: cb.onError,
                onClose: function () { cb.onClose(); },
            });
        },

        showInterstitial(cb) {
            jamBridge().showInterstitial({
                onOpen: cb.onOpen,
                onError: cb.onError,
                onClose: function () { cb.onClose(); },
            });
        },

        // Neither window.Jam nor the portal's mock player exposes preload state — the JAM
        // contract has no readiness call at all. Report ready: a genuine 'not_ready' still
        // arrives through onError (the mock even enforces a 30 s frequency cap), whereas
        // answering false here would hide the offer permanently on a host that can show ads.
        isRewardedReady() { return true; },
        isInterstitialReady() { return true; },

        // Banners are deliberately NOT declared: they are not in the JAM contract
        // (game-bridge-contract.md §2). Leaving the capability out is what lets the request
        // fall through to whatever layer can actually draw one.

        eventSink() {
            const j = jamBridge();
            return (j && typeof j.logEvent === 'function') ? j : null;
        },

        // getUserId() is null on the JAM portal by design — isRewardMode() is the documented
        // gate for reward mechanics, and it is always false there.
        context() {
            return jamBridge();
        },
    });
})();
;
/**
 * platform/sim.js — localhost ad simulator.
 *
 * Registers itself ONLY on 127.0.0.1 / localhost in a top-level window; anywhere else this
 * file returns before touching the registry, so production behaves exactly as if it had not
 * been shipped. An iframe is excluded because an embedded page is being driven by a real
 * parent host, and a fake one must not answer for it.
 *
 * Even on localhost the simulator never shadows a real host: every other adapter registers
 * with a lower priority number and therefore resolves first.
 *
 * Tweak window.__adsSim from devtools to exercise every callback branch.
 *
 * Ads only: no host(), no event sink, no player context — a simulated host must not invent a
 * language, a cloud best score or a user id.
 */
(function () {
    'use strict';

    const isLocalhost = typeof window !== 'undefined'
        && window.location
        && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
    const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
    if (!isLocalhost || isEmbedded) return;

    const sim = (window.__adsSim = {
        available: true,
        adsEnabled: true,
        rewardedReady: true,
        interstitialReady: true,
        bannerVisible: true,
        nextRewardedStatus: 'rewarded',      // rewarded|dismissed|error|not_ready|disabled|busy
        nextInterstitialStatus: 'dismissed', // dismissed|error|not_ready|disabled|busy
        showLatencyMs: 1200,
    });

    let busy = false;

    function dispatchRewarded(cb, status) {
        busy = true;
        setTimeout(() => {
            if (status === 'rewarded') cb.onReward && cb.onReward();
            if (status === 'error' || status === 'disabled' ||
                status === 'not_ready' || status === 'busy') {
                cb.onError && cb.onError({ status });
            }
            cb.onClose && cb.onClose();
            busy = false;
        }, sim.showLatencyMs);
    }

    function dispatchInterstitial(cb, status) {
        busy = true;
        setTimeout(() => {
            if (status === 'error' || status === 'disabled' ||
                status === 'not_ready' || status === 'busy') {
                cb.onError && cb.onError({ status });
            }
            cb.onClose && cb.onClose();
            busy = false;
        }, sim.showLatencyMs);
    }

    window.GamePlatformRegistry.register({
        name: 'sim',
        priority: 30,

        // Read live from window.__adsSim, never captured: flipping the flag in devtools has to
        // take effect on the next call, exactly like a real host appearing or disappearing.
        available() { return !!sim.available; },

        showRewarded(cb) {
            if (!sim.available) { cb.onError && cb.onError({ status: 'unavailable' }); cb.onClose && cb.onClose(); return; }
            cb.onOpen && cb.onOpen();
            if (busy) return dispatchRewarded(cb, 'busy');
            if (!sim.adsEnabled) return dispatchRewarded(cb, 'disabled');
            dispatchRewarded(cb, sim.nextRewardedStatus);
        },

        showInterstitial(cb) {
            if (!sim.available) { cb.onError && cb.onError({ status: 'unavailable' }); cb.onClose && cb.onClose(); return; }
            cb.onOpen && cb.onOpen();
            if (busy) return dispatchInterstitial(cb, 'busy');
            if (!sim.adsEnabled) return dispatchInterstitial(cb, 'disabled');
            // Only the success status is turned into 'not_ready' by an unready slot: an
            // explicitly requested failure status must reach the game unchanged.
            if (!sim.interstitialReady && sim.nextInterstitialStatus === 'dismissed') {
                return dispatchInterstitial(cb, 'not_ready');
            }
            dispatchInterstitial(cb, sim.nextInterstitialStatus);
        },

        isRewardedReady() { return sim.available && sim.adsEnabled && sim.rewardedReady; },
        isInterstitialReady() { return sim.available && sim.adsEnabled && sim.interstitialReady; },
        showBanner() { if (!sim.available) return false; sim.bannerVisible = sim.adsEnabled; return true; },
        hideBanner() { if (!sim.available) return false; sim.bannerVisible = false; return true; },
        isBannerVisible() { return sim.available && sim.adsEnabled && sim.bannerVisible; },
    });
})();
;
/**
 * platform/yandex.js — Yandex Games adapter.
 *
 * Owns the only asynchronous bootstrap in the platform layer: the platform serves /sdk.js
 * itself, and yandex-sdk.js wraps it. core.js calls boot() only when no other adapter
 * answered at load, so on a host that does not serve /sdk.js this file is never reached
 * and its 404 never stalls whenReady().
 *
 * Ships in the yandex target only.
 */
(function () {
    'use strict';

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.async = false;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error('failed to load ' + src));
            (document.head || document.documentElement).appendChild(el);
        });
    }

    function sdk() {
        const s = window.YandexSDK;
        return (s && typeof s.isAvailable === 'function') ? s : null;
    }

    function ready() {
        const s = sdk();
        return (s && s.isAvailable()) ? s : null;
    }

    // ------------------------------------------------------------------
    // Lifecycle / storage / host events — the GamePlatform half.
    // ------------------------------------------------------------------
    const host = {
        getLanguage() {
            const s = ready();
            return (s && typeof s.getLanguage === 'function') ? s.getLanguage() : null;
        },

        // Deliberately NOT gated on isAvailable(): the wrapper records an early request and
        // replays it once init lands, which is what keeps "signal ready before the game
        // becomes playable" true even while the SDK is still booting.
        gameReady() {
            const s = sdk();
            return (s && typeof s.gameReady === 'function') ? !!s.gameReady() : true;
        },

        startGameplay() {
            const s = sdk();
            return (s && typeof s.startGameplay === 'function') ? !!s.startGameplay() : false;
        },

        stopGameplay() {
            const s = sdk();
            return (s && typeof s.stopGameplay === 'function') ? !!s.stopGameplay() : false;
        },

        onPause(listener) {
            const s = sdk();
            return (s && typeof s.onPause === 'function') ? s.onPause(listener) : function () {};
        },

        onResume(listener) {
            const s = sdk();
            return (s && typeof s.onResume === 'function') ? s.onResume(listener) : function () {};
        },

        isPaused() {
            const s = sdk();
            return !!(s && typeof s.isPaused === 'function' && s.isPaused());
        },

        saveBestScore(score) {
            const s = ready();
            return (s && typeof s.saveBestScore === 'function') ? s.saveBestScore(score) : false;
        },

        getBestScore() {
            const s = ready();
            return (s && typeof s.getBestScore === 'function') ? s.getBestScore() : null;
        },

        // The platform's own required events, mapped from neutral names.
        reportEvent(event) {
            const s = ready();
            if (!s) return false;

            const name = event && event.name;
            const params = (event && event.params) || {};

            if (name === 'game_start' && typeof s.dispatchGameStartEvent === 'function') {
                s.dispatchGameStartEvent();
                return true;
            }

            if (name === 'level_complete' && typeof s.dispatchLevelCompleteEvent === 'function') {
                s.dispatchLevelCompleteEvent(params.level);
                return true;
            }

            return false;
        },
    };

    window.GamePlatformRegistry.register({
        name: 'yandex',
        priority: 40,

        available() {
            return !!ready();
        },

        showRewarded(cb) {
            window.YandexSDK.showRewardedVideo({
                onOpen: cb.onOpen,
                onRewarded: cb.onReward,
                onError: cb.onError,
                onClose: cb.onClose,
            });
        },

        showInterstitial(cb) {
            window.YandexSDK.showFullscreenAdv({
                onOpen: cb.onOpen,
                onError: cb.onError,
                onClose: cb.onClose,
            });
        },

        // The SDK exposes no preload query, and answering false would hide the offer
        // permanently on a host that can show ads. A real "no fill" still arrives as
        // onError({ status: 'not_ready' }).
        isRewardedReady() { return true; },
        isInterstitialReady() { return true; },

        showBanner() {
            const s = ready();
            if (!s || typeof s.showBannerAdv !== 'function') return false;
            s.showBannerAdv();
            return true;
        },

        hideBanner() {
            const s = ready();
            if (!s || typeof s.hideBannerAdv !== 'function') return false;
            s.hideBannerAdv();
            return true;
        },

        host() {
            return sdk() ? host : null;
        },

        // whenReady() resolves only after init() has finished, so game code never inits
        // anything itself and never polls for readiness.
        boot(done) {
            loadScript('/sdk.js')
                .catch(() => { /* not served by this host */ })
                .then(() => loadScript('yandex-sdk.js'))
                .catch(() => { /* wrapper missing */ })
                .then(() => {
                    const s = sdk();
                    if (!s || typeof s.init !== 'function') return false;
                    return s.init().then(() => true, () => true);
                })
                .then((answered) => done(!!answered), () => done(false));
        },
    });
})();
