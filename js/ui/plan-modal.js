/**
 * 抽卡规划弹窗：打开 / 关闭。
 *
 * 抽卡规划不再占用主页面版面，改为弹窗呈现。
 * 入口按钮（#btnOpenPlan）位于「抽卡资源统计」模块的标题栏内，
 * 但事件绑定放在本模块，保持「谁拥有弹窗、谁负责开关」的边界。
 *
 * 版本列表的内容与编辑由 js/ui/plan.js 负责，本模块只管显隐。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;

    var el = {};

    function cacheElements() {
        el.overlay = util.$('planOverlay');
        el.openBtn = util.$('btnOpenPlan');
        el.closeBtn = util.$('btnClosePlan');
    }

    function isOpen() {
        return !!el.overlay && el.overlay.classList.contains('show');
    }

    function open() {
        if (!el.overlay) return;
        el.overlay.classList.add('show');
        // 打开后把焦点放到关闭按钮，便于键盘操作与 Esc 关闭
        if (el.closeBtn && el.closeBtn.focus) el.closeBtn.focus();
    }

    function close() {
        if (!el.overlay) return;
        el.overlay.classList.remove('show');
    }

    function toggle() {
        if (isOpen()) {
            close();
        } else {
            open();
        }
    }

    function bind() {
        util.on(el.openBtn, 'click', open);
        util.on(el.closeBtn, 'click', close);

        // 点击遮罩层关闭
        util.on(el.overlay, 'click', function (event) {
            if (event.target === el.overlay) close();
        });

        // Esc 关闭
        util.on(document, 'keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });
    }

    function init() {
        cacheElements();
        bind();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.planModal = {
        init: init,
        open: open,
        close: close,
        toggle: toggle,
        isOpen: isOpen
    };
})(window.ZMD);
