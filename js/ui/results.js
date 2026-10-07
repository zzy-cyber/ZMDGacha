/**
 * 计算结果区：步骤表格 + 汇总条。
 *
 * 计算全部委托给 ZMD.calc（纯函数），本模块只负责把步骤数据翻译成 DOM。
 * 所有可变文案都通过类名控制配色，颜色定义在 css/results.css 中。
 *
 * 「设置」列（本模块的编辑入口）：
 *  - 抽取：该角色是否纳入抽取计划；
 *  - 当日：是否按「当日获取」结算（先扣后加）；
 *  - 上半卡池时间已过：双角色版本的上半抽数不计入总抽数（仅上半行出现）；
 *  - 抽取武器：该角色的武器是否抽取（-15840 武库配额，每个角色各自一个开关，
 *    只在设置里开启了「武库配额获取」功能时展示）。
 * 勾选结果直接写入 store，再由 renderer 触发重算与重绘。
 *
 * 「判断方式」列已移除（每种判断的说明文案较长，会把表格撑宽、必须横向滚动才能看全），
 * 判读信息改由「结果」列的状态标签承担：⏭️ 跳过 / ⏭️ 上半已过 / ✅ 足够 / ❌ 不足，
 * 以及角色名后的「当日获取」「抽武器」标签。
 *
 * 「武库抽数」列：武库配额的独立推演结果（不计入总抽数）。
 * 功能关闭时只显示手填武库配额的换算值；开启后按卡池抽取收入（每角色 +8160）
 * 与武器抽取支出（每把武器 -15840）逐行展示。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.store;

    /** 表格列数，空状态提示需要用它设置 colspan（已去掉「判断方式」列） */
    var COLUMN_COUNT = 8;

    /** 取消抽取时联动关闭「当日获取」与「抽取武器」 */
    var LINKED_FIELDS = {
        role1Pull: ['role1DayOne', 'role1Weapon'],
        role2Pull: ['role2DayOne', 'role2Weapon']
    };

    var el = {};

    function cacheElements() {
        el.table = util.$('resultTable');
        el.tableBody = util.$('resultTableBody');
        el.summaryInitial = util.$('summaryInitial');
        el.summaryRemaining = util.$('summaryRemaining');
        el.summaryTargetCount = util.$('summaryTargetCount');
        el.summaryStatus = util.$('summaryStatus');
    }

    // ======================== 行模板 ========================

    function emptyRow(icon, message) {
        return '<tr>' +
            '<td colspan="' + COLUMN_COUNT + '" class="empty-cell">' + icon + ' ' + message + '</td>' +
            '</tr>';
    }

    /** 是否开启武库配额获取 / 武器抽取功能 */
    function isArsenalEnabled() {
        return !!store.getState().settings.arsenalPlanEnabled;
    }

    /** 带符号的抽数文案（0 显示为 0） */
    function signedPulls(value) {
        return (value > 0 ? '+' : '') + util.toFixed(value, 1);
    }

    /**
     * 「武库抽数」单元格。
     * 有变化时展示此行增减 + 当前累计，没有变化时只展示累计值。
     * @param {object} step
     * @param {boolean} withBalance 是否附上「当前累计」小字
     */
    function arsenalCell(step, withBalance) {
        if (!isArsenalEnabled()) return '<td class="arsenal-cell">-</td>';

        var delta = Number(step.arsenalDeltaPulls) || 0;
        var total = Number(step.arsenalTotalPulls) || 0;
        var mainClass = delta > 0 ? 'arsenal-value is-gain'
            : (delta < 0 ? 'arsenal-value is-cost' : 'arsenal-value is-flat');
        var mainText = delta === 0 ? util.toFixed(total, 1) : signedPulls(delta);

        var balance = (withBalance && delta !== 0)
            ? '<span class="arsenal-balance">余 ' + util.toFixed(total, 1) + '</span>'
            : '';

        return '<td class="arsenal-cell" title="武库配额 ' + util.toFixed(total, 1) + ' 抽（不计入总抽数）">' +
            '<span class="' + mainClass + '">' + mainText + '</span>' + balance +
            '</td>';
    }

    /** 版本收入行 */
    function incomeRow(step) {
        return '' +
            '<tr class="step-row row-income">' +
                '<td class="version-cell">' + util.escapeHTML(step.versionLabel) + '<br><small>版本收入</small></td>' +
                '<td class="role-name-cell">💰 版本收入</td>' +
                '<td class="setting-cell">-</td>' +
                '<td class="pull-cell pull-cell-plus">+' + step.income + ' 抽</td>' +
                '<td class="pull-cell">-</td>' +
                '<td class="status-income">+收入</td>' +
                '<td class="pull-cell">' + step.finalTotal + ' 抽</td>' +
                arsenalCell(step, false) +
            '</tr>';
    }

    /** 一个勾选框（勾选状态即写回 store 的字段值） */
    function checkBox(step, field, checked, options) {
        var o = options || {};
        return '' +
            '<label class="mini-check' + (o.extraClass ? ' ' + o.extraClass : '') + (o.muted ? ' is-muted' : '') + '">' +
                '<input type="checkbox" data-version="' + step.versionIndex + '" data-field="' + field + '"' +
                    (checked ? ' checked' : '') + (o.disabled ? ' disabled' : '') + '>' +
                '<span>' + o.label + '</span>' +
            '</label>';
    }

    /** 「设置」单元格：抽取 / 当日 / 上半卡池时间已过 / 抽取武器 */
    function settingCell(step) {
        var roleNo = step.roleIndex;
        var pullField = 'role' + roleNo + 'Pull';
        var dayOneField = 'role' + roleNo + 'DayOne';
        var weaponField = 'role' + roleNo + 'Weapon';

        var skipOn = !!step.skipHalf;
        var pulling = !!step.pullRequested;

        var html = '';

        // 抽取武器：每个角色各自一个开关（各自扣 15840 武库配额）。
        // 只有开启武库配额功能时才展示；不抽该角色时武器没有意义，置灰。
        if (isArsenalEnabled()) {
            html += checkBox(step, weaponField, !!step.weaponPull, {
                label: '抽取武器',
                extraClass: 'check-weapon',
                disabled: skipOn || !pulling,
                muted: skipOn || !pulling
            });
        }

        html += checkBox(step, pullField, pulling, {
            label: '抽取',
            disabled: skipOn,
            muted: skipOn
        });

        html += checkBox(step, dayOneField, !!step.dayOneRequested, {
            label: '当日',
            disabled: skipOn || !pulling,
            muted: skipOn || !pulling
        });

        // 只有双角色版本的上半行才有「上半卡池时间已过」
        if (step.hasHalf2 && step.isHalf1) {
            html += checkBox(step, 'skipHalf1', skipOn, {
                label: '上半卡池时间已过',
                extraClass: 'check-skip'
            });
        }

        return '<td class="setting-cell"><div class="setting-cell-inner">' + html + '</div></td>';
    }

    /** 判断状态对应的文案与类名。 */
    function resolveStatus(step) {
        if (step.skipHalf) return { text: '⏭️ 上半已过', className: 'status-skip' };
        if (!step.willPull) return { text: '⏭️ 跳过', className: 'status-skip' };
        if (step.enough) return { text: '✅ 足够', className: 'status-enough' };
        return { text: '❌ 不足', className: 'status-short' };
    }

    /** 半场抽数单元格：已过期的半场加删除线 */
    function resolvePullsCell(step) {
        if (step.skipHalf) {
            return '<td class="pull-cell pull-cell-skipped">+' + step.halfPulls + ' 抽</td>';
        }
        return '<td class="pull-cell">+' + step.halfPulls + ' 抽</td>';
    }

    /** 一行数据的单元格（已去掉「判断方式」列，避免表格过宽需要横向滚动） */
    function stepRow(step) {
        var status = resolveStatus(step);
        var dayOneTag = step.dayOne ? '<span class="tag-day-one">当日获取</span>' : '';
        var weaponTag = step.weaponPull ? '<span class="tag-weapon">抽武器</span>' : '';
        var afterDeduct = step.afterDeduct !== null ? (step.afterDeduct + ' 抽') : '-';
        // 最后一个干员在「当日 + 足够」时，扣除后抽数已计入本半场抽数（= 最终剩余）
        var afterDeductTitle = step.afterDeductWithHalf
            ? ' title="列表最后一个干员：已把本半场抽数计入，即为规划结束时的剩余"'
            : '';

        return '' +
            '<tr class="step-row' + (step.skipHalf ? ' row-skipped' : '') + '">' +
                '<td class="version-cell">' + util.escapeHTML(step.versionLabel) + '<br><small>' + step.halfLabel + '</small></td>' +
                '<td class="role-name-cell">' + util.escapeHTML(step.roleName) + dayOneTag + weaponTag + '</td>' +
                settingCell(step) +
                resolvePullsCell(step) +
                '<td class="pull-cell">' + step.beforeJudgment + ' 抽</td>' +
                '<td class="' + status.className + '">' + status.text + '</td>' +
                '<td class="pull-cell"' + afterDeductTitle + '>' + afterDeduct + '</td>' +
                arsenalCell(step, true) +
            '</tr>';
    }

    // ======================== 汇总 ========================

    function setValueClass(element, className) {
        element.className = 's-value ' + className;
    }

    function renderSummary(result) {
        el.summaryInitial.textContent = result.initialTotal + ' 抽';
        el.summaryRemaining.textContent = result.finalTotal + ' 抽';
        el.summaryTargetCount.textContent = result.targetCount + ' 个';

        if (result.targetCount === 0) {
            el.summaryStatus.textContent = '无需抽取';
            setValueClass(el.summaryStatus, 'neutral');
        } else if (result.shortCount === 0) {
            el.summaryStatus.textContent = '全部足够 (' + result.enoughCount + '/' + result.targetCount + ')';
            setValueClass(el.summaryStatus, 'good');
        } else {
            el.summaryStatus.textContent = result.shortCount + '个不足 (够' + result.enoughCount + '/' + result.targetCount + ')';
            setValueClass(el.summaryStatus, 'warn');
        }

        setValueClass(el.summaryRemaining, result.finalTotal < 0 ? 'warn' : 'good');
    }

    // ======================== 勾选交互 ========================

    /**
     * 记住当前聚焦的勾选框，重绘后把焦点放回去。
     * 结果表每次勾选都会整体重绘，若不还原焦点，键盘连续勾选会中断。
     */
    function captureFocus() {
        var active = document.activeElement;
        if (!active || active.type !== 'checkbox') return null;
        var field = active.getAttribute('data-field');
        var version = active.getAttribute('data-version');
        if (!field || version === null) return null;
        return { field: field, version: version };
    }

    function restoreFocus(snapshot) {
        if (!snapshot) return;
        var target = el.tableBody.querySelector(
            '[data-field="' + snapshot.field + '"][data-version="' + snapshot.version + '"]');
        if (target && !target.disabled && target.focus) target.focus();
    }

    /** 结果表中的勾选 → store（true 表示「从结果表反向设置版本参数」） */
    function handleChange(event) {
        var target = event.target;
        if (!target || target.type !== 'checkbox') return;

        var field = target.getAttribute('data-field');
        if (!field) return;

        var index = util.toInt(target.getAttribute('data-version'));
        var list = store.getState().versionDataList;
        if (index < 0 || index >= list.length) return;

        var snapshot = captureFocus();
        store.updateVersionField(index, field, target.checked);

        // 取消抽取时联动收起相关开关：
        // 「当日获取」失去意义（与原逻辑一致），该角色的「抽取武器」也没有武器可抽
        if (target.checked === false && LINKED_FIELDS[field]) {
            LINKED_FIELDS[field].forEach(function (linkedField) {
                store.updateVersionField(index, linkedField, false);
            });
        }

        // 重绘由 renderer 合并到下一帧执行，这里等它画完再把焦点还给用户
        setTimeout(function () { restoreFocus(snapshot); }, 0);
    }

    // ======================== 渲染 ========================

    /** 重新计算并渲染结果区。 */
    function render() {
        var state = store.getState();
        var result = ZMD.calc.run(state.versionDataList, state.resources, state.settings);

        // 关闭武库配额功能时整列隐藏，避免表格变宽却没内容
        var arsenalOn = !!state.settings.arsenalPlanEnabled;
        if (el.table) el.table.classList.toggle('hide-arsenal', !arsenalOn);

        if (result.steps.length === 0) {
            el.tableBody.innerHTML = emptyRow('📭', '暂无数据，请点击「抽卡资源统计」中的「📋 抽卡规划」添加版本');
        } else {
            el.tableBody.innerHTML = result.steps.map(function (step) {
                return step.isIncome ? incomeRow(step) : stepRow(step);
            }).join('');
        }

        renderSummary(result);
    }

    function init() {
        cacheElements();
        // 勾选框用事件委托：表格内容重绘后依然有效
        util.on(el.tableBody, 'change', handleChange);
        render();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.results = {
        init: init,
        render: render
    };
})(window.ZMD);
