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
