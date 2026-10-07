/**
 * 抽卡规划区：版本列表的渲染与编辑（内容位于「抽卡规划」弹窗中）。
 *
 * 渲染策略：
 *  - 版本列表变动时整体重建（与原实现一致）；
 *  - 编辑事件用「事件委托」绑定在容器上，只绑定一次，
 *    因此重建 DOM 不会重复绑定监听器，新增字段也无需改动绑定代码；
 *  - 输入写入 store，具体重算交给 renderer 统一处理。
 *
 * 分工约定：
 *  - 本模块只负责「版本本身」的结构化设置（名称、规模、角色数、抽数、收入）；
 *  - 「是否抽取 / 当日获取 / 上半卡池时间已过」属于推演过程的开关，
 *    统一在 js/ui/results.js 的结果表里勾选。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.store;
    var calc = ZMD.calc;

    /** 需要按整数解析的字段（select 的 value 是字符串，必须转换后才能与 === 比较） */
    var NUMBER_FIELDS = ['customTotalPulls', 'customHalf1Pulls', 'largePulls', 'smallPulls', 'versionIncome', 'roleCount'];

    var el = {};

    function cacheElements() {
        el.list = util.$('versionList');
    }

    // ======================== 模板 ========================

    /**
     * 角色区块（只保留名称输入，抽取开关在结果表中）。
     * @param {object} options
     */
    function roleBlock(options) {
        var pullTooltip = '需要' + calc.RATES.pullsPerRole + '抽 | 半场提供' + options.pulls + '抽';
        return '' +
            '<div class="role-block">' +
                '<span class="role-label">' + options.emoji + ' ' + options.title + '</span>' +
                '<input type="text" value="' + util.escapeHTML(options.name) + '" placeholder="' + options.placeholder + '"' +
                    ' data-version="' + options.index + '" data-field="' + options.nameField + '" class="version-input" maxlength="24">' +
                '<span class="pull-info">' + pullTooltip + '</span>' +
                '<span class="role-hint">是否抽取 / 当日获取请在「计算结果」中勾选</span>' +
            '</div>';
    }

    /** 版本自定义名称 */
    function versionNameField(index, value) {
        return '' +
            '<div class="full-width">' +
                '<label class="field-label">🏷️ 版本名称（可自定义，显示在结果表中）</label>' +
                '<input type="text" value="' + util.escapeHTML(value) + '" data-version="' + index + '"' +
                    ' data-field="versionName" class="version-input" maxlength="24" placeholder="例如：1.2 版本 / 星尘">' +
            '</div>';
    }

    /** 版本收入输入 */
    function incomeField(index, value) {
        return '' +
            '<div class="full-width">' +
                '<label class="field-label">💰 版本收入（抽数，抽取前先加入总抽数）</label>' +
                '<input type="number" value="' + util.toInt(value) + '" data-version="' + index + '"' +
                    ' data-field="versionIncome" class="version-number-input" min="0" step="1" placeholder="该版本收入抽数">' +
            '</div>';
    }

    /**
     * 渲染单个版本卡片。
     * @param {object} version
     * @param {number} index
     * @param {object} settings
     */
    function versionCard(version, index, settings) {
        var isCustom = version.scale === 'custom';
        var isLarge = version.scale === 'large';
        var isTwoRoles = version.roleCount === 2;
        var vInfo = calc.getVersionPullInfo(version, settings);

        var badge = isCustom
            ? '<span class="badge badge-small">自定义</span>'
            : (isLarge ? '<span class="badge badge-large">大版本</span>' : '<span class="badge badge-small">小版本</span>');

        var customName = String(version.versionName == null ? '' : version.versionName).trim();

        // 版本标题栏：序号 + 自定义名称 + 规模徽标 + 总抽数
        var head =
            '<div class="card-header">' +
                '<span class="version-num">📌 版本 ' + (index + 1) +
                    (customName ? '<span class="version-name-text">' + util.escapeHTML(customName) + '</span>' : '') +
                    ' ' + badge +
                    '<span class="version-total">共' + vInfo.totalPulls + '抽</span>' +
                '</span>' +
                '<button class="btn-delete" data-action="delete-version" data-delete="' + index + '" title="删除此版本">🗑️ 删除</button>' +
            '</div>';

        var scaleSelect =
            '<div>' +
                '<label class="field-label">版本规模</label>' +
                '<select data-version="' + index + '" data-field="scale" class="version-select">' +
                    '<option value="large"' + (isLarge ? ' selected' : '') + '>大版本（' + (version.largePulls || settings.defaultLargePulls) + '抽）</option>' +
                    '<option value="small"' + (version.scale === 'small' ? ' selected' : '') + '>小版本（' + (version.smallPulls || settings.defaultSmallPulls) + '抽）</option>' +
                    '<option value="custom"' + (isCustom ? ' selected' : '') + '>自定义版本</option>' +
                '</select>' +
            '</div>';

        var roleCountSelect =
            '<div>' +
                '<label class="field-label">角色数量</label>' +
                '<select data-version="' + index + '" data-field="roleCount" class="version-select">' +
                    '<option value="1"' + (version.roleCount === 1 ? ' selected' : '') + '>1个角色</option>' +
                    '<option value="2"' + (isTwoRoles ? ' selected' : '') + '>2个角色</option>' +
                '</select>' +
            '</div>';

        // 总抽数输入：大/小版本用各自默认值，自定义版本额外提供上半抽数
        var totalPullsField = '';
        if (!isCustom) {
            var defaultLabel = isLarge
                ? '大版本默认' + settings.defaultLargePulls
                : '小版本默认' + settings.defaultSmallPulls;
            var fieldName = isLarge ? 'largePulls' : 'smallPulls';
            var fieldValue = isLarge
                ? (version.largePulls || settings.defaultLargePulls)
                : (version.smallPulls || settings.defaultSmallPulls);
            totalPullsField =
                '<div class="full-width">' +
                    '<label class="field-label">版本总抽数（' + defaultLabel + '）</label>' +
                    '<input type="number" value="' + fieldValue + '" data-version="' + index + '"' +
                        ' data-field="' + fieldName + '" class="version-number-input" min="0" step="1" placeholder="输入总抽数">' +
                '</div>';
        } else {
            var half2Value = Math.max(0, (version.customTotalPulls || 0) - (version.customHalf1Pulls || 0));
            totalPullsField =
                '<div class="full-width">' +
                    '<label class="field-label">版本总抽数</label>' +
                    '<input type="number" value="' + (version.customTotalPulls || 0) + '" data-version="' + index + '"' +
                        ' data-field="customTotalPulls" class="version-number-input" min="0" step="1" placeholder="输入总抽数">' +
                '</div>' +
                (isTwoRoles
                    ? '<div>' +
                        '<label class="field-label">上半抽数</label>' +
                        '<input type="number" value="' + (version.customHalf1Pulls || 0) + '" data-version="' + index + '"' +
                            ' data-field="customHalf1Pulls" class="version-number-input" min="0" step="1" placeholder="上半抽数">' +
                      '</div>' +
                      '<div>' +
                        '<label class="field-label">下半抽数（自动 = 总 - 上）</label>' +
                        '<input type="number" value="' + half2Value + '" readonly disabled' +
                            ' class="version-number-input version-readonly">' +
                      '</div>'
                    : '');
        }

        var role1Block = roleBlock({
            index: index,
            emoji: '🎭',
            title: '角色1（' + vInfo.half1Label + ' · +' + vInfo.half1Pulls + '抽）',
            pulls: vInfo.half1Pulls,
            name: version.role1Name,
            placeholder: '角色1名称',
            nameField: 'role1Name'
        });

        var role2Block = isTwoRoles
            ? roleBlock({
                index: index,
                emoji: '🎭',
                title: '角色2（' + vInfo.half2Label + ' · +' + vInfo.half2Pulls + '抽）',
                pulls: vInfo.half2Pulls,
                name: version.role2Name,
                placeholder: '角色2名称',
                nameField: 'role2Name'
            })
            : '';

        return '' +
            '<div class="version-card" data-version="' + index + '">' +
                head +
                '<div class="card-body">' +
                    versionNameField(index, customName) +
                    scaleSelect +
                    roleCountSelect +
                    totalPullsField +
                    role1Block +
                    role2Block +
                    incomeField(index, version.versionIncome) +
                '</div>' +
            '</div>';
    }

    /** 渲染整个版本列表。 */
    function render() {
        if (!el.list) return;

        var state = store.getState();
        var list = state.versionDataList;

        if (list.length === 0) {
            el.list.innerHTML = '<div class="empty-hint">📋 暂无版本规划，点击下方按钮添加版本</div>';
            return;
        }

        el.list.innerHTML = list.map(function (version, index) {
            return versionCard(version, index, state.settings);
        }).join('');
    }

    // ======================== 事件 ========================

    /**
     * 事件委托：容器上只绑定一次，内部的增删改都走这里。
     * 用 WeakSet 记录已绑定容器，避免重复绑定。
     */
    var delegated = typeof WeakSet === 'function' ? new WeakSet() : null;

    function readIndex(target) {
        var index = util.toInt(target.getAttribute('data-version'));
        var list = store.getState().versionDataList;
        return (index >= 0 && index < list.length) ? index : -1;
    }

    function handleFieldChange(target) {
        var field = target.getAttribute('data-field');
        if (!field) return false;

        var index = readIndex(target);
        if (index < 0) return false;

        var value;
        if (target.type === 'checkbox') {
            value = target.checked;
        } else if (NUMBER_FIELDS.indexOf(field) >= 0) {
            value = util.toInt(target.value);
        } else {
            value = target.value;
        }

        store.updateVersionField(index, field, value);
        return true;
    }

    function handleDelete(target) {
        var index = util.toInt(target.getAttribute('data-delete'));
        if (!store.removeVersion(index)) return;

        store.save();
        ZMD.toast.show('已删除版本 ' + (index + 1));
    }

    function handleClick(event) {
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (!target) return;
        if (target.getAttribute('data-action') === 'delete-version') handleDelete(target);
    }

    function handleInput(event) {
        handleFieldChange(event.target);
    }

    function bindDelegation(root) {
        if (!root) return;
        if (delegated) {
            if (delegated.has(root)) return;
            delegated.add(root);
        } else if (root.getAttribute('data-delegated') === '1') {
            return;
        } else {
            root.setAttribute('data-delegated', '1');
        }

        util.on(root, 'click', handleClick);
        util.onAll(root, ['input', 'change'], handleInput);
    }

    function init() {
        cacheElements();
        bindDelegation(el.list);
        render();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.plan = {
        init: init,
        render: render
    };
})(window.ZMD);
