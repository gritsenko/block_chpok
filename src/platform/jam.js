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
