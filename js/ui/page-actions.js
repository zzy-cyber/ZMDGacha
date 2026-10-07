/**
 * 页面级操作：添加版本、重置版本列表、清除本地缓存。
 * 所有数据操作都通过 store，界面刷新由 renderer 统一完成。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.store;

    var SCROLL_DELAY = 150;

    /** 添加一个新版本，并滚动到新卡片。 */
    function addVersion() {
        store.addVersion();
        store.save();
        ZMD.toast.show('✅ 已添加版本 ' + store.getState().versionDataList.length);

        // 等 renderer 完成重绘后再定位（版本卡片在规划弹窗的可滚动区域内）
        setTimeout(function () {
            var cards = util.$$('.version-card');
            if (cards.length === 0) return;
            var lastCard = cards[cards.length - 1];
            if (typeof lastCard.scrollIntoView === 'function') {
                lastCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, SCROLL_DELAY);
    }

    /** 清空版本规划。 */
    function resetVersions() {
        if (store.getState().versionDataList.length === 0) {
            ZMD.toast.show('版本列表已为空');
            return;
        }
        if (!window.confirm('确定要清空所有版本规划吗？此操作不可恢复。')) return;

        store.clearVersions();
        store.save();
        ZMD.toast.show('🔄 版本列表已重置');
    }

    /** 清除本地缓存（资源 + 规划 + 设置），并恢复到初始状态。 */
    function clearCache() {
        if (!window.confirm('确定要清除所有本地缓存数据吗？包括资源数据和版本规划都将被清空。')) return;

        store.resetAll();
        ZMD.ui.resources.syncInputsFromState();
        ZMD.toast.show('✅ 本地缓存已清除');
    }

    function bind() {
        var actions = {
            'add-version': addVersion,
            'reset-versions': resetVersions,
            'clear-cache': clearCache
        };

        util.$$('[data-action]').forEach(function (element) {
            var handler = actions[element.getAttribute('data-action')];
            if (handler) util.on(element, 'click', handler);
        });
    }

    function init() {
        bind();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.pageActions = {
        init: init,
        addVersion: addVersion,
        resetVersions: resetVersions,
        clearCache: clearCache
    };
})(window.ZMD);
