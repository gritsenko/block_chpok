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
