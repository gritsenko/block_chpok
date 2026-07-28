/**
 * platform.js — single-file ads/monetization SDK for embedded HTML5 games.
 *
 * Public contract: window.GameAds (see GAME_ADS_API.md).
 *   GameAds.platform                                       // 'native' | 'web'
 *   GameAds.provider()                                     // which host answers right now
 *   GameAds.hasProvider()                                  // any provider available
 *   GameAds.showRewarded({ onOpen, onReward, onError, onClose })
 *   GameAds.showInterstitial({ onOpen, onError, onClose })
 *   GameAds.isRewardedReady() / isInterstitialReady()
 *   GameAds.showBanner() / hideBanner() / isBannerVisible()
 *   GameAds.whenYandexReady()                              // promise<boolean>
 *   GameAds.levelComplete(level, params) / logEvent(name, params)
 *   GameAds.getUserId() / isRewardMode() / getGameId()
 *
 * Four environments, zero game-code changes:
 *   1. window.Jam host    — the MY.GAMES JAM portal (jam-sdk.js, mock ad player) and
 *                           rnd-lab APK builds (jam-compat.js → RewardHub → AppLovin).
 *                           One contract, both places: jam.my.games/docs/game-bridge-contract.md.
 *   2. Android APK shell  — native @JavascriptInterface (window.AdsBridge) is detected
 *                           and wrapped. AppLovin MAX shows real ads.
 *   3. Yandex Games       — Yandex SDK is lazy-loaded; ads come from Yandex.
 *   4. Browser / localhost — built-in simulator. Tweak window.__adsSim from devtools
 *                           to exercise every callback branch.
 *
 * Jam is preferred over the raw native bridge deliberately: both end up in the same
 * AppLovin call, but only the Jam/RewardHub path also carries progress events, custom
 * events and ILRD attribution. Reaching for AdsBridge directly is the fallback for a
 * shell that ships no SDK.
 *
 * Callback contract is identical across providers:
 *   • onClose ALWAYS fires exactly once and last (even on errors / no provider).
 *   • onReward fires only when the user earned the reward.
 *   • onError fires for status ∈ { error, not_ready, disabled, busy, unavailable }.
 *     For interstitials, 'dismissed' is the SUCCESS path — onClose without onError.
 *
 * The raw native bridge (window.AdsBridge) and the simulator's adapter are
 * intentionally NOT exposed on window — game code consumes only GameAds.
 */
(function () {
    'use strict';

    // The raw @JavascriptInterface installed by the APK shell, if any.
    const rawBridge = (typeof window !== 'undefined') ? window.AdsBridge : null;

    // The wrapped raw-native adapter. Stays null until localAdapter() builds it on
    // first use — see §3 for why this must not happen at load time.
    let adapter = null;

    // -----------------------------------------------------------------------
    // 1. Native adapter — wraps window.AdsBridge into a uniform shape.
    //    Was previously a separate ads-bridge.js; inlined so the SDK is one file.
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

        // We intentionally do NOT key `available` off rawBridge.isAdsEnabled():
        // some shells don't expose it at all, and the native side already returns
        // 'disabled' through the callback when ads are off. Keying off enabled
        // here would hide the second-chance offer even when ads work fine.
        return {
            available: true,
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
    // 2. Localhost simulator — only when no native bridge present AND we're on
    //    127.0.0.1 / localhost. Production, native shell, and Yandex are
    //    never affected. Tweak window.__adsSim from devtools to control outcomes.
    // -----------------------------------------------------------------------
    function buildSimulator() {
        const isLocalhost = typeof window !== 'undefined'
            && window.location
            && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
        const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
        if (!isLocalhost || isEmbedded) return null;

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

        return {
            get available() { return sim.available; },
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
        };
    }

    // -----------------------------------------------------------------------
    // 3. Host facades we do NOT create: window.Jam (jam-sdk.js on the JAM portal,
    //    jam-compat.js in an rnd-lab APK) and window.AdsManager (rnd-lab ads-bridge.js).
    //    Both are resolved LAZILY, on every call, for two reasons:
    //      • rnd-lab's build_service inserts their <script> tags before </head>, i.e.
    //        AFTER this file — neither object exists while we are being evaluated;
    //      • ads-bridge.js installs its own window.__adsCallback. Building our raw
    //        native adapter eagerly would let that overwrite ours, and every rewarded
    //        show would then hang with no onClose. So the raw adapter is built on
    //        first use, and only once we know no higher-level facade answered.
    // -----------------------------------------------------------------------
    function jamBridge() {
        const j = window.Jam || window.jam;
        if (!j || typeof j.showRewarded !== 'function') return null;
        // jam-sdk reports available=false with no simulator parent to talk to;
        // jam-compat mirrors RewardHub.available. Either way: no host, no ads.
        return j.available === false ? null : j;
    }

    function hubAdsManager() {
        const m = window.AdsManager;
        if (!m || !m.available || typeof m.showRewardedVideo !== 'function') return null;
        return m;
    }

    const simAdapter = buildSimulator();
    let rawAdapterResolved = false;

    // Raw native bridge / simulator — the local adapters, in that order.
    function localAdapter() {
        if (!rawAdapterResolved) {
            rawAdapterResolved = true;
            adapter = buildNativeAdapter();
        }
        return adapter || simAdapter;
    }

    const hasRawBridge = !!(rawBridge && typeof rawBridge.showRewarded === 'function');
    const platform = (hasRawBridge || simAdapter) ? 'native' : 'web';

    // -----------------------------------------------------------------------
    // 4. Yandex Games SDK — lazy-loaded only when no other host was detected.
    //    /sdk.js is served by the Yandex platform; outside it we still try
    //    yandex-sdk.js so window.YandexSDK exists and reports unavailable.
    // -----------------------------------------------------------------------
    let resolveYandexReady;
    const yandexReadyPromise = new Promise(resolve => { resolveYandexReady = resolve; });

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

    // A host bridge already present at load means Yandex is not our platform. Skipping
    // the fetch matters on the JAM portal: /sdk.js 404s there, and every consumer of
    // whenYandexReady() (splash gate, language) would wait out that round trip for nothing.
    const hostAtLoad = hasRawBridge ? 'native bridge'
        : simAdapter ? 'localhost simulator'
        : jamBridge() ? 'window.Jam host'
        : null;

    if (hostAtLoad) {
        resolveYandexReady(false);
        console.log('[platform] ' + hostAtLoad + ' ready — Yandex SDK skipped.');
    } else {
        loadScript('/sdk.js')
            .catch(() => { /* not served by this host */ })
            .then(() => loadScript('yandex-sdk.js'))
            .catch(() => { /* wrapper missing */ })
            .then(() => { resolveYandexReady(!!window.YandexSDK); });
    }

    // -----------------------------------------------------------------------
    // 5. Provider detection + public facade.
    // -----------------------------------------------------------------------
    function hasJam() { return !!jamBridge(); }
    function hasHub() { return !!hubAdsManager(); }
    function hasLocal() {
        const a = localAdapter();
        return !!(a && a.available);
    }
    function hasYandex() {
        return !!(window.YandexSDK
            && typeof window.YandexSDK.isAvailable === 'function'
            && window.YandexSDK.isAvailable());
    }
    // Order is the resolution order used by every show* below, and the ||
    // short-circuit is load-bearing: with a Jam host present we never build the
    // raw adapter, so ads-bridge.js keeps sole ownership of window.__adsCallback.
    function hasProvider() { return hasJam() || hasHub() || hasLocal() || hasYandex(); }

    // Which host would actually serve the next ad. Evaluated on read, unlike `platform`.
    function provider() {
        if (hasJam()) return 'jam';
        if (hasHub()) return 'hub';
        if (hasLocal()) return localAdapter() === simAdapter ? 'sim' : 'native';
        if (hasYandex()) return 'yandex';
        return 'none';
    }

    function safe(fn, arg) {
        if (typeof fn !== 'function') return;
        try { fn(arg); } catch (e) { console.warn('[platform] callback threw', e); }
    }

    function showInterstitial(callbacks) {
        const cb = callbacks || {};
        let finished = false;
        let errored = false;
        const finish = (wasShown) => {
            if (finished) return;
            finished = true;
            safe(cb.onClose, wasShown);
        };
        const onOpen = () => safe(cb.onOpen);
        const onError = (result) => { errored = true; safe(cb.onError, result || { status: 'error' }); };

        if (hasJam()) {
            jamBridge().showInterstitial({
                onOpen: onOpen,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'jam';
        }
        if (hasHub()) {
            hubAdsManager().showInterstitial({
                onOpen: onOpen,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'hub';
        }
        if (hasLocal()) {
            localAdapter().showInterstitial({
                onOpen: onOpen,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'native';
        }
        if (hasYandex()) {
            window.YandexSDK.showFullscreenAdv({
                onOpen: onOpen,
                onError: onError,
                onClose: (wasShown) => finish(errored ? false : wasShown !== false),
            });
            return 'yandex';
        }
        onError({ status: 'unavailable' });
        finish(false);
        return 'none';
    }

    function showRewarded(callbacks) {
        const cb = callbacks || {};
        let finished = false;
        let errored = false;
        const finish = (wasShown) => {
            if (finished) return;
            finished = true;
            safe(cb.onClose, wasShown);
        };
        const onOpen = () => safe(cb.onOpen);
        const onReward = () => safe(cb.onReward);
        const onError = (result) => { errored = true; safe(cb.onError, result || { status: 'error' }); };

        if (hasJam()) {
            jamBridge().showRewarded({
                onOpen: onOpen,
                onReward: onReward,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'jam';
        }
        if (hasHub()) {
            hubAdsManager().showRewardedVideo({
                onOpen: onOpen,
                onReward: onReward,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'hub';
        }
        if (hasLocal()) {
            localAdapter().showRewarded({
                onOpen: onOpen,
                onReward: onReward,
                onError: onError,
                onClose: () => finish(!errored),
            });
            return 'native';
        }
        if (hasYandex()) {
            window.YandexSDK.showRewardedVideo({
                onOpen: onOpen,
                onRewarded: onReward,
                onError: onError,
                onClose: (wasShown) => finish(errored ? false : wasShown !== false),
            });
            return 'yandex';
        }
        onError({ status: 'unavailable' });
        finish(false);
        return 'none';
    }

    // Neither window.Jam nor the portal's mock player exposes preload state — the JAM
    // contract has no readiness call at all. Report ready: a genuine 'not_ready' still
    // arrives through onError (the mock even enforces a 30 s frequency cap), whereas
    // answering false here would hide the offer permanently on a host that can show ads.
    function isInterstitialReady() {
        if (hasJam()) return true;
        if (hasHub()) {
            try { return !!hubAdsManager().isInterstitialReady(); } catch (e) { return false; }
        }
        const a = hasLocal() ? localAdapter() : null;
        if (a && typeof a.isInterstitialReady === 'function') {
            return !!a.isInterstitialReady();
        }
        return hasYandex();
    }

    function isRewardedReady() {
        if (hasJam()) return true;
        if (hasHub()) {
            try { return !!hubAdsManager().isRewardedReady(); } catch (e) { return false; }
        }
        const a = hasLocal() ? localAdapter() : null;
        if (a && typeof a.isRewardedReady === 'function') {
            return !!a.isRewardedReady();
        }
        return hasYandex();
    }

    // Banners are deliberately NOT in the JAM contract (game-bridge-contract.md §2), so
    // they skip the Jam branch entirely and go to whatever layer can actually draw one.
    function showBanner() {
        if (hasHub() && typeof hubAdsManager().showBanner === 'function') {
            try { hubAdsManager().showBanner(); return true; } catch (e) { return false; }
        }
        if (hasLocal() && typeof localAdapter().showBanner === 'function') {
            return !!localAdapter().showBanner();
        }
        if (hasYandex() && typeof window.YandexSDK.showBannerAdv === 'function') {
            window.YandexSDK.showBannerAdv();
            return true;
        }
        return false;
    }

    function hideBanner() {
        if (hasHub() && typeof hubAdsManager().hideBanner === 'function') {
            try { hubAdsManager().hideBanner(); return true; } catch (e) { return false; }
        }
        if (hasLocal() && typeof localAdapter().hideBanner === 'function') {
            return !!localAdapter().hideBanner();
        }
        if (hasYandex() && typeof window.YandexSDK.hideBannerAdv === 'function') {
            window.YandexSDK.hideBannerAdv();
            return true;
        }
        return false;
    }

    function isBannerVisible() {
        if (hasHub() && typeof hubAdsManager().isBannerVisible === 'function') {
            try { return !!hubAdsManager().isBannerVisible(); } catch (e) { return false; }
        }
        if (hasLocal() && typeof localAdapter().isBannerVisible === 'function') {
            return !!localAdapter().isBannerVisible();
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // 6. Progress + custom events. Only the Jam/RewardHub family has an event sink;
    //    Yandex keeps its own analytics calls where they were (game.js drives
    //    dispatchGameStartEvent / dispatchLevelCompleteEvent on Yandex's schedule,
    //    which is a different contract with different required moments).
    //
    //    Event-name rules come from the portal and are enforced server-side:
    //    [a-z0-9_]{1,64}, never generated dynamically (unique names are capped per
    //    project), and `level_complete` + anything `ad_*` are reserved — the portal
    //    mints those itself, including all ad telemetry.
    // -----------------------------------------------------------------------
    function eventSink() {
        const j = jamBridge();
        if (j && typeof j.logEvent === 'function') return j;
        const rh = window.RewardHub;
        return (rh && typeof rh.logEvent === 'function') ? rh : null;
    }

    function logEvent(name, params) {
        const sink = eventSink();
        if (!sink) return false;
        try {
            sink.logEvent(name, params);
            return true;
        } catch (e) {
            console.warn('[platform] logEvent failed', e);
            return false;
        }
    }

    function levelComplete(level, params) {
        const sink = eventSink();
        if (!sink || typeof sink.levelComplete !== 'function') return false;
        try {
            sink.levelComplete(level, params);
            return true;
        } catch (e) {
            console.warn('[platform] levelComplete failed', e);
            return false;
        }
    }

    // Context, for UX decisions and storage namespacing. All three degrade to a
    // "no host" answer rather than throwing, so game code can call them unguarded.
    // getUserId() is null on the JAM portal by design — isRewardMode() is the
    // documented gate for reward mechanics, and it is always false there.
    function facade() { return jamBridge() || window.RewardHub || null; }

    function getUserId() {
        const f = facade();
        try { return (f && f.getUserId) ? (f.getUserId() || null) : null; } catch (e) { return null; }
    }

    function isRewardMode() {
        const f = facade();
        try { return !!(f && f.isRewardMode && f.isRewardMode()); } catch (e) { return false; }
    }

    function getGameId() {
        const f = facade();
        try { return (f && f.getGameId) ? (f.getGameId() || null) : null; } catch (e) { return null; }
    }

    window.GameAds = {
        platform: platform,
        provider: provider,
        whenYandexReady: function () { return yandexReadyPromise; },
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

    console.log('[platform] GameAds ready (platform=' + platform + ', host=' + (hostAtLoad || 'pending') + ').');
})();
