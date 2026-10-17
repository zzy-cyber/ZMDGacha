/**
 * 收集统计的纯计算层（不接触 DOM）。
 *
 * 统计口径：
 *  - 角色拥有率 = 已拥有角色数 / 角色总数；
 *  - 专武持有率 = 「已拥有且已拥有专武」的角色数 / 已拥有角色数。
 *    也就是说，未拥有角色的专武不会进入分母，也不会进入分子 ——
 *    这与需求「已拥有角色的专武持有率」一致。
 *
 * 纯函数设计让统计规则可以单独测试，也能被未来的导出 / 分享界面复用。
 */
(function (ZMD) {
    'use strict';

    /** 允许的筛选值 */
    var FILTERS = ['all', 'owned', 'unowned'];

    /** 除法安全版：分母为 0 时返回 0 */
    function ratio(part, total) {
        return total > 0 ? part / total : 0;
    }

    /**
     * 百分比文案：最多一位小数，整数不显示 .0。
     * 0 → "0%"；0.6666… → "66.7%"；1 → "100%"。
     */
    function formatPercent(rate) {
        var value = (Number(rate) || 0) * 100;
        if (!isFinite(value) || value <= 0) return '0%';
        if (value >= 100) return '100%';
        return value.toFixed(1).replace(/\.0$/, '') + '%';
    }

    /**
     * 单个版本的统计。
     * @param {object} version
     * @returns {object}
     */
    function versionStats(version) {
        var characters = (version && version.characters) || [];
        var total = characters.length;
        var owned = 0;
        var ownedWithWeapon = 0;
        var weaponOwned = 0;

        characters.forEach(function (character) {
            var isOwned = !!character.owned;
            var hasWeapon = !!character.weaponOwned;
            if (isOwned) owned += 1;
            if (hasWeapon) weaponOwned += 1;
            if (isOwned && hasWeapon) ownedWithWeapon += 1;
        });

        return {
            versionCount: 1,
            /** 角色总数 */
            total: total,
            /** 已拥有角色数 */
            owned: owned,
            /** 未拥有角色数 */
            unowned: total - owned,
            /** 已拥有的专武数量（包含未拥有角色的专武，仅用于展示） */
            weaponOwned: weaponOwned,
            /** 已拥有角色中，同时拥有专武的数量（专武持有率的分子） */
            ownedWithWeapon: ownedWithWeapon,
            /** 专武持有率的分母：已拥有角色数 */
            weaponBase: owned,
            charRate: ratio(owned, total),
            weaponRate: ratio(ownedWithWeapon, owned)
        };
    }

    /**
     * 全部版本的汇总统计。
     * @param {Array<object>} versions
     * @returns {object}
     */
    function overallStats(versions) {
        var list = versions || [];
        var result = {
            versionCount: list.length,
            total: 0,
            owned: 0,
            unowned: 0,
            weaponOwned: 0,
            ownedWithWeapon: 0,
            weaponBase: 0,
            charRate: 0,
            weaponRate: 0
        };

        list.forEach(function (version) {
            var stats = versionStats(version);
            result.total += stats.total;
            result.owned += stats.owned;
            result.weaponOwned += stats.weaponOwned;
            result.ownedWithWeapon += stats.ownedWithWeapon;
        });

        result.unowned = result.total - result.owned;
        result.weaponBase = result.owned;
        result.charRate = ratio(result.owned, result.total);
        result.weaponRate = ratio(result.ownedWithWeapon, result.owned);
        return result;
    }

    /**
     * 按筛选条件挑出角色，同时保留原始下标（写回 store 需要）。
     * @param {object} version
     * @param {string} filter 'all' | 'owned' | 'unowned'
     * @returns {Array<{character: object, index: number}>}
     */
    function filterCharacters(version, filter) {
        var characters = (version && version.characters) || [];
        var result = [];

        characters.forEach(function (character, index) {
            if (filter === 'owned' && !character.owned) return;
            if (filter === 'unowned' && character.owned) return;
            result.push({ character: character, index: index });
        });

        return result;
    }

    /**
     * 某个筛选值对应的角色数量。
     * @param {object} stats 汇总统计
     * @param {string} filter
     */
    function countForFilter(stats, filter) {
        if (filter === 'owned') return stats.owned;
        if (filter === 'unowned') return stats.unowned;
        return stats.total;
    }

    ZMD.collectionCalc = {
        FILTERS: FILTERS,
        formatPercent: formatPercent,
        versionStats: versionStats,
        overallStats: overallStats,
        filterCharacters: filterCharacters,
        countForFilter: countForFilter
    };
})(window.ZMD);
