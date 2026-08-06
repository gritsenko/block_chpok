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
