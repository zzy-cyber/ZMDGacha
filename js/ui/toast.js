/**
 * Toast 轻提示。
 * 调用 ZMD.toast.show('消息') 即可，2 秒后自动隐藏。
 */
(function (ZMD) {
    'use strict';

    var HIDE_DELAY = 2000;

    var el = null;
    var timer = null;

    function ensureElement() {
        if (!el) el = ZMD.util.$('toast');
        return el;
    }

    /**
     * 显示一条提示。
     * @param {string} message
     */
    function show(message) {
        var node = ensureElement();
        if (!node) return;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        node.textContent = message;
        node.classList.add('show');

        timer = setTimeout(function () {
            node.classList.remove('show');
            timer = null;
        }, HIDE_DELAY);
    }

    /** 立即隐藏。 */
    function hide() {
        var node = ensureElement();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (node) node.classList.remove('show');
    }

    ZMD.toast = {
        show: show,
        hide: hide
    };
})(window.ZMD);
