/**
 * 抽卡资源统计区。
 *
 * 职责：
 *  - 把用户在输入框里的修改写回 store（状态唯一来源）；
 *  - 根据 store + 计算层的结果刷新换算文案与总抽数展示；
 *  - 模块可整块收起 / 展开，收起状态记在 settings 中（刷新后保持）；
 *  - 「📋 抽卡规划」入口按钮也在这里（按钮本体的事件由 js/ui/plan-modal.js 绑定）。
 *
 * 本模块不负责触发重算：store 变化后由 js/renderer.js 统一驱动界面刷新，
 * 这样各模块之间无需互相调用。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.store;
    var calc = ZMD.calc;

    /** 资源字段 → DOM 元素 id */
    var FIELDS = [
        { field: 'crystalJade', input: 'crystalJade', conversion: 'crystalJadeConv', target: 'input' },
        { field: 'guaranteeQuota', input: 'guaranteeQuota', conversion: 'guaranteeQuotaConv', target: 'input' },
        { field: 'sourceStone', input: 'sourceStone', conversion: 'sourceStoneConv', target: 'input' },
        { field: 'arsenalQuota', input: 'arsenalQuota', conversion: 'arsenalQuotaConv', target: 'input' },
        { field: 'manualPulls', input: 'manualPulls', conversion: 'manualPullsConv', target: 'input' },
        { field: 'includeSourceStone', input: 'includeSourceStone', target: 'checkbox' }
    ];

    var el = {};
    /** 字段名 → 换算文案元素，便于按字段直接取用 */
    var conversionEls = {};

    function cacheElements() {
        el.section = util.$('resource-section');
        el.toggle = util.$('btnToggleResources');
        el.badge = util.$('resourceTotalBadge');
        el.totalPulls = util.$('totalPulls');
        el.totalDetail = util.$('totalDetail');
        el.arsenalPulls = util.$('arsenalPullsDisplay');
        el.arsenalDetail = util.$('arsenalDetail');
        FIELDS.forEach(function (item) {
            item.inputEl = util.$(item.input);
            item.conversionEl = item.conversion ? util.$(item.conversion) : null;
            conversionEls[item.field] = item.conversionEl;
        });
    }

    /** 状态 → 输入框（用于初始化与重置后回填）。 */
    function syncInputsFromState() {
        var resources = store.getState().resources;
        FIELDS.forEach(function (item) {
            if (!item.inputEl) return;
            var value = resources[item.field];
            if (item.target === 'checkbox') {
                item.inputEl.checked = !!value;
            } else if (document.activeElement !== item.inputEl) {
                // 避免打断正在输入的字段（光标跳动）
                item.inputEl.value = value;
            }
        });
    }

    /** 安全设置文本（元素缺失时忽略）。 */
    function setText(element, text) {
        if (element) element.textContent = text;
    }

    /** 刷新换算文案与总抽数展示。 */
    function updateDisplay() {
        var state = store.getState();
        var resources = state.resources;
        var useArsenal = !!state.settings.arsenalPlanEnabled;
        var ctx = calc.buildPullContext(resources);
        var rates = calc.RATES;

        setText(conversionEls.crystalJade, '= ' + ctx.crystalJadePulls + ' 抽（' + util.toInt(resources.crystalJade) + ' ÷ ' + rates.crystalJadePerPull + '）');
        setText(conversionEls.guaranteeQuota, '= ' + ctx.guaranteeQuotaPulls + ' 抽（' + util.toInt(resources.guaranteeQuota) + ' ÷ ' + rates.guaranteeQuotaPerPull + '）');

        if (ctx.includeSourceStone) {
            var effective = Math.max(0, ctx.sourceStoneAmount - rates.sourceStoneFree);
            setText(conversionEls.sourceStone,
                '= ' + ctx.sourceStonePulls + ' 抽（(' + ctx.sourceStoneAmount + ' - ' + rates.sourceStoneFree + ') × ' +
                rates.sourceStonePulls + ' ÷ ' + rates.sourceStonePerPull + '，有效超出: ' + effective + '）');
        } else {
            setText(conversionEls.sourceStone, '= 0 抽（未计入）');
        }

        setText(conversionEls.arsenalQuota,
            '= ' + util.toFixed(ctx.arsenalBasePulls, 1) + ' 抽（' + ctx.arsenalQuotaAmount + ' ÷ ' + rates.arsenalQuotaPerPull + '）');
        setText(conversionEls.manualPulls, '= ' + ctx.manualPulls + ' 抽（直接计入总抽数）');

        setText(el.totalPulls, ctx.totalPulls);
        setText(el.badge, '🎯 ' + ctx.totalPulls + ' 抽');

        renderArsenalDisplay(ctx, useArsenal);

        var parts = [];
        parts.push('嵌晶玉: ' + ctx.crystalJadePulls + '抽');
        parts.push('保障配额: ' + ctx.guaranteeQuotaPulls + '抽');
        parts.push(ctx.includeSourceStone ? ('衍质源石: ' + ctx.sourceStonePulls + '抽') : '衍质源石: 未计入');
        if (ctx.manualPulls !== 0) parts.push('手动: ' + ctx.manualPulls + '抽');
        setText(el.totalDetail, parts.join(' | '));
    }

    /**
     * 武库配额抽数展示。
     * 未开启功能时，展示手填武库配额的换算值；开启后展示推演结果：
     * 卡池抽取收入（每个被抽的卡池 +8160）与武器抽取支出（每把武器 -15840）。
     *
     * 收入 / 支出依赖整份规划，因此这里复用 calc.run 的推演结果
     * （与结果表读的是同一份数据，不会出现两处不一致）。
     * @param {object} ctx 资源换算结果（提供 arsenalBasePulls / arsenalQuotaAmount）
     * @param {boolean} useArsenal 功能开关
     */
    function renderArsenalDisplay(ctx, useArsenal) {
        var rates = calc.RATES;
        var basePulls = ctx.arsenalBasePulls;

        if (!useArsenal) {
            setText(el.arsenalPulls, util.toFixed(basePulls, 1));
            setText(el.arsenalDetail,
                '武库配额 ' + ctx.arsenalQuotaAmount + ' ÷ ' + rates.arsenalQuotaPerPull + '，不计入总抽数');
            return;
        }

        var state = store.getState();
        var arsenal = calc.run(state.versionDataList, state.resources, state.settings).arsenal;

        setText(el.arsenalPulls, util.toFixed(arsenal.totalPulls, 1));

        var detailParts = [];
        detailParts.push('初始 ' + util.toFixed(basePulls, 1) + ' 抽');
        detailParts.push('卡池获取 +' + util.toFixed(arsenal.gainPulls, 1) + ' 抽（' +
            Math.round(arsenal.gainPulls * rates.arsenalQuotaPerPull) + ' 配额）');
        if (arsenal.costPulls > 0) {
            detailParts.push('武器抽取 -' + util.toFixed(arsenal.costPulls, 1) + ' 抽（' +
                Math.round(arsenal.costPulls * rates.arsenalQuotaPerPull) + ' 配额' +
                (arsenal.weaponCount > 1 ? '，共 ' + arsenal.weaponCount + ' 把武器' : '') + '）');
        }
        detailParts.push('净变化 ' + signedPulls(arsenal.totalPulls - basePulls));
        setText(el.arsenalDetail, detailParts.join(' | '));
    }

    /** 带符号的抽数文案（0 显示为 +0） */
    function signedPulls(value) {
        var rounded = parseFloat(Number(value).toFixed(1));
        return (rounded > 0 ? '+' : '') + util.toFixed(rounded, 1);
    }

    /** 输入框 → 状态。 */
    function bindInputs() {
        FIELDS.forEach(function (item) {
            if (!item.inputEl) return;

            if (item.target === 'checkbox') {
                util.on(item.inputEl, 'change', function () {
                    store.setResource(item.field, this.checked);
                });
                return;
            }

            util.onAll(item.inputEl, ['input', 'change'], function () {
                var raw = this.value;
                // 空值或只输入了负号时按 0 处理（手动抽数支持负数，如 -50）
                if (raw === '' || raw === '-') raw = '0';
                store.setResource(item.field, util.toInt(raw));
            });
        });
    }

    // ======================== 收起 / 展开 ========================

    function isCollapsed() {
        return !!store.getState().settings.resourcesCollapsed;
    }

    /** 把收起状态写到界面上（状态本身由 store 保存）。 */
    function applyCollapsed() {
        if (!el.section) return;
        var collapsed = isCollapsed();

        el.section.classList.toggle('is-collapsed', collapsed);
        if (el.toggle) {
            el.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            el.toggle.setAttribute('title', collapsed ? '展开抽卡资源统计' : '收起抽卡资源统计');
        }
    }

    /** 切换收起状态并立即持久化（这是纯界面偏好，无需等待自动保存）。 */
    function toggleCollapsed() {
        store.setSettings({ resourcesCollapsed: !isCollapsed() });
        store.saveSettings();
        applyCollapsed();
    }

    function bindCollapse() {
        util.on(el.toggle, 'click', toggleCollapsed);
    }

    function init() {
        cacheElements();
        syncInputsFromState();
        bindInputs();
        bindCollapse();
        applyCollapsed();
        updateDisplay();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.resources = {
        init: init,
        syncInputsFromState: syncInputsFromState,
        updateDisplay: updateDisplay,
        applyCollapsed: applyCollapsed,
        toggleCollapsed: toggleCollapsed
    };
})(window.ZMD);
