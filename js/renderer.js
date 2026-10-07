/**
 * 界面刷新调度中心。
 *
 * 订阅 store 的变化，按变更类型决定刷新哪些区域：
 *  - resources：只刷新资源统计区与结果区；
 *  - versions：版本列表结构变化，需要重建卡片，再刷新结果区；
 *  - fields：只是某个输入框的值变了，默认不重建卡片（否则会打断输入光标），
 *    但如果变化的字段属于「结构字段」（版本规模 / 角色数量），
 *    卡片上的徽标、「共N抽」、角色半场标签都必须一起更新，此时同样重建；
 *  - settings：卡片上的「默认抽数」文案会变，需要重建卡片
 *    （资源区收起状态、武库配额开关也走这里，重绘代价很小）。
 *
 * 结果表的勾选（抽取 / 当日 / 上半卡池时间已过 / 抽取武器）写入版本字段，属于 fields 变更：
 * 默认不重建规划弹窗里的卡片，只重算并重绘结果表。
 *
 * 多个变更会被合并到同一个渲染帧执行，避免连续输入时重复重绘。
 * 各界面模块因此不需要互相调用；新增数据只需在这里声明它影响哪些区域。
 */
(function (ZMD) {
    'use strict';

    var store = ZMD.store;

    var scheduled = false;
    var frameHandle = null;

    /** 请求一次刷新（合并到下一帧）。 */
    function schedule() {
        if (scheduled) return;
        scheduled = true;

        var run = function () {
            scheduled = false;
            frameHandle = null;
            renderAll();
        };

        if (typeof requestAnimationFrame === 'function') {
            frameHandle = requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    /**
     * 本帧变化的字段里是否包含「必须重建规划卡片」的结构字段。
     * @param {Array<string>} fieldNames
     */
    function hasStructuralFieldChange(fieldNames) {
        var structural = store.STRUCTURAL_VERSION_FIELDS || [];
        return (fieldNames || []).some(function (field) {
            return structural.indexOf(field) >= 0;
        });
    }

    /**
     * 刷新界面。
     * @param {boolean} [force=false] 强制全部重绘（首次渲染使用）
     */
    function renderAll(force) {
        var changes = store.consumeChangedKeys(force);

        // 结构字段（版本规模 / 角色数量）变化时，卡片内容会整体变化，必须重建
        var structuralFieldChanged = hasStructuralFieldChange(changes.fieldNames);

        var refreshList = force || changes.versions || changes.settings || structuralFieldChanged;
        var refreshResources = force || changes.resources || changes.settings || changes.versions;
        // 资源区里的「武库配额抽数」依赖版本勾选（卡池获取 / 武器抽取），
        // 因此字段变化时也要重算，否则总抽数刷新了、武库配额却停在旧值
        var refreshArsenal = changes.fields;

        if (!force && !refreshList && !refreshResources && !refreshArsenal) return;

        if (refreshList) ZMD.ui.plan.render();
        if (refreshResources) {
            ZMD.ui.resources.updateDisplay();
            ZMD.ui.resources.applyCollapsed();
        } else if (refreshArsenal) {
            ZMD.ui.resources.updateDisplay();
        }
        ZMD.ui.results.render();
    }

    /** 首次渲染：立即执行，保证页面立刻有内容。 */
    function init() {
        renderAll(true);
        store.subscribe(schedule);
    }

    ZMD.renderer = {
        init: init,
        renderAll: renderAll,
        schedule: schedule,
        cancelPending: function () {
            if (frameHandle !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(frameHandle);
            }
            frameHandle = null;
            scheduled = false;
        }
    };
})(window.ZMD);
