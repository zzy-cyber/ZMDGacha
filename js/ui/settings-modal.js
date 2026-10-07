/**
 * 默认抽数设置弹窗 + 功能开关。
 *
 *  - 默认抽数：修改后只影响之后新增的版本，已有版本保持原值（与原逻辑一致）；
 *  - 武库配额获取：可开关的功能，开启后结果表才推演武库配额收支。
 * 两项都在点「保存」时一起写入 store，再由 renderer 统一刷新界面。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.store;

    var el = {};

    function cacheElements() {
        el.overlay = util.$('settingsOverlay');
        el.inputLarge = util.$('settingLargePulls');
        el.inputSmall = util.$('settingSmallPulls');
        el.inputArsenal = util.$('settingArsenalPlan');
    }

    function open() {
        var settings = store.getState().settings;
        el.inputLarge.value = settings.defaultLargePulls;
        el.inputSmall.value = settings.defaultSmallPulls;
        if (el.inputArsenal) el.inputArsenal.checked = !!settings.arsenalPlanEnabled;
        el.overlay.classList.add('show');

        // 打开后聚焦第一个输入框，便于键盘操作
        if (el.inputLarge.focus) el.inputLarge.focus();
    }

    function close() {
        el.overlay.classList.remove('show');
    }

    function isOpen() {
        return el.overlay.classList.contains('show');
    }

    function save() {
        var large = util.toInt(el.inputLarge.value) || 104;
        var small = util.toInt(el.inputSmall.value) || 73;
        var arsenalPlanEnabled = el.inputArsenal ? !!el.inputArsenal.checked : false;
        var arsenalChanged = arsenalPlanEnabled !== !!store.getState().settings.arsenalPlanEnabled;

        store.setSettings({
            defaultLargePulls: large,
            defaultSmallPulls: small,
            arsenalPlanEnabled: arsenalPlanEnabled
        });
        store.saveSettings();
        close();

        // 设置变更会触发 renderer 重绘，这里只负责提示
        ZMD.toast.show('✅ 默认抽数已更新：大版本' + store.getState().settings.defaultLargePulls +
            '抽，小版本' + store.getState().settings.defaultSmallPulls + '抽' +
            (arsenalChanged
                ? '；武库配额获取已' + (arsenalPlanEnabled ? '开启' : '关闭')
                : ''));
    }

    function bind() {
        util.on(util.$('btnOpenSettings'), 'click', open);
        util.on(util.$('btnCancelSettings'), 'click', close);
        util.on(util.$('btnSaveSettings'), 'click', save);

        // 点击遮罩层关闭
        util.on(el.overlay, 'click', function (event) {
            if (event.target === el.overlay) close();
        });

        // Esc 关闭（新增的键盘便利，不影响原有交互）
        util.on(document, 'keydown', function (event) {
            if (event.key === 'Escape' && isOpen()) close();
        });
    }

    function init() {
        cacheElements();
        bind();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.settingsModal = {
        init: init,
        open: open,
        close: close
    };
})(window.ZMD);
