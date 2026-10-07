/**
 * 应用状态中心（单一数据源）。
 *
 * 设计要点：
 *  - 所有界面模块只读写这里的状态，不各自持有副本；
 *  - 任何修改都经过 set / 具体方法，修改后统一触发订阅者回调；
 *  - 数据结构与旧版 localStorage 完全兼容，老数据可直接读取。
 *
 * 扩展方式：新增一组状态时，在 state 中加字段，并补充对应的读写方法即可；
 * 界面模块通过 ZMD.store.subscribe() 订阅变化，无需彼此感知。
 */
(function (ZMD) {
    'use strict';

    var storage = ZMD.storage;
    var KEYS = storage.KEYS;

    /**
     * 结构字段：一旦被修改，规划卡片必须整体重建。
     * 这类字段会改变卡片的结构或卡片内多处文案（例如切换版本规模后，
     * 标题徽标、总抽数、角色半场标签都要跟着变），只重算结果表是不够的。
     *
     * 因此 store 在 updateVersionField 里把它们标记为「versions」变更，
     * renderer 据此重建版本列表；其余字段属于「fields」变更，
     * 只重算并重绘结果表，避免打断正在输入的输入框（光标丢失）。
     */
    var STRUCTURAL_VERSION_FIELDS = ['scale', 'roleCount'];

    /** 默认抽数设置（resourcesCollapsed 为纯界面偏好，一并持久化）。 */
    function defaultSettings() {
        return {
            defaultLargePulls: 104,
            defaultSmallPulls: 73,
            /** 界面偏好：资源统计区是否收起 */
            resourcesCollapsed: false,
            /** 功能开关：是否启用「武库配额获取 / 武器抽取」推演 */
            arsenalPlanEnabled: false
        };
    }

    /** 单个版本的数据结构（新版本在使用时也会带上这些默认值）。 */
    var VERSION_DEFAULTS = {
        versionName: '',
        scale: 'large',
        customTotalPulls: 104,
        customHalf1Pulls: 58,
        customHalf2Pulls: 46,
        largePulls: 104,
        smallPulls: 73,
        roleCount: 1,
        role1Name: '',
        role1Pull: true,
        role1DayOne: false,
        /** 角色1 / 角色2 的武器是否抽取（各自消耗武库配额，由设置里的功能开关控制） */
        role1Weapon: false,
        role2Name: '',
        role2Pull: true,
        role2DayOne: false,
        role2Weapon: false,
        versionIncome: 0,
        skipHalf1: false
    };

    var state = {
        /** 资源数量（保存原始数量，抽数由 calculator 换算） */
        resources: {
            crystalJade: 0,
            guaranteeQuota: 0,
            sourceStone: 0,
            arsenalQuota: 0,
            manualPulls: 0,
            includeSourceStone: true
        },
        /** 版本规划列表 */
        versionDataList: [],
        /** 默认抽数设置 */
        settings: defaultSettings()
    };

    var listeners = [];

    /**
     * 待处理的变更标记，由 renderer 在每个渲染帧读取并清空。
     * 用途：区分「资源数字变了」和「版本卡片结构变了」，
     * 前者不需要重建卡片（重建会打断输入光标），后者必须重建。
     */
    var changedKeys = { resources: true, versions: true, settings: true };

    /**
     * 本帧内发生过变化的版本字段名（去重）。
     * 与 changedKeys 的 'fields' 标记配合使用：renderer 需要知道具体是哪个字段变了，
     * 才能判断它是否属于「必须重建卡片」的结构字段；只记录一个布尔值会漏刷新。
     */
    var changedFields = [];

    /**
     * 记录一次变更。
     * @param {string} key 'resources' | 'versions' | 'settings' | 'fields'
     * @param {string} [field] 当 key 为 'fields' 时，具体变化的版本字段名
     */
    function markChanged(key, field) {
        changedKeys[key] = true;
        if (key === 'fields' && field && changedFields.indexOf(field) < 0) {
            changedFields.push(field);
        }
    }

    /**
     * 读取并清空变更标记。
     * @param {boolean} [reset=false] 是否直接重置为「全部已变更」
     */
    function consumeChangedKeys(reset) {
        var result = changedKeys;
        changedKeys = reset
            ? { resources: true, versions: true, settings: true }
            : { resources: false, versions: false, settings: false };
        result.fieldNames = changedFields;
        changedFields = [];
        return result;
    }

    /** 通知所有订阅者。 */
    function notify(reason) {
        listeners.slice().forEach(function (listener) {
            try {
                listener(state, reason);
            } catch (e) {
                console.error('[ZMD.store] 订阅者执行出错:', e);
            }
        });
    }

    /**
     * 订阅状态变化。
     * @param {(state: object, reason: string) => void} listener
     * @returns {function(): void} 取消订阅
     */
    function subscribe(listener) {
        listeners.push(listener);
        return function () {
            var i = listeners.indexOf(listener);
            if (i >= 0) listeners.splice(i, 1);
        };
    }

    function getState() {
        return state;
    }

    /** 生成一个带默认值的版本对象。 */
    function createVersion(overrides) {
        var version = Object.assign({}, VERSION_DEFAULTS, {
            largePulls: state.settings.defaultLargePulls,
            smallPulls: state.settings.defaultSmallPulls
        });
        return Object.assign(version, overrides || {});
    }

    /**
     * 补齐旧数据缺失的字段（只补缺失项，已存在的值原样保留）。
     * 同时做一次字段迁移：早期版本用的是「版本级」pullWeapon（整个版本只有
     * 一个武器开关，且只出现在上半卡池行），现在改为每个角色各自的
     * role1Weapon / role2Weapon。旧数据里勾选过 pullWeapon 的版本，
     * 迁移为「该版本内实际抽取的角色都抽武器」，避免用户的选择丢失。
     */
    function migrateVersion(raw) {
        var merged = Object.assign({}, VERSION_DEFAULTS, {
            largePulls: state.settings.defaultLargePulls,
            smallPulls: state.settings.defaultSmallPulls
        });
        var source = raw || {};
        Object.keys(source).forEach(function (key) {
            if (source[key] !== undefined) merged[key] = source[key];
        });

        if (source.pullWeapon === true && source.role1Weapon === undefined && source.role2Weapon === undefined) {
            merged.role1Weapon = source.role1Pull !== false;
            merged.role2Weapon = source.roleCount === 2 && source.role2Pull !== false;
        }
        delete merged.pullWeapon;
        return merged;
    }

    // ======================== 资源 ========================

    /**
     * 更新一个资源字段。
     * @param {string} field resources 中的字段名
     * @param {*} value
     */
    function setResource(field, value) {
        if (!(field in state.resources)) {
            console.warn('[ZMD.store] 未知资源字段:', field);
            return;
        }
        if (state.resources[field] === value) return;
        state.resources[field] = value;
        markChanged('resources');
        notify('resources');
    }

    // ======================== 版本列表 ========================

    /** 追加一个版本。 */
    function addVersion(overrides) {
        state.versionDataList = state.versionDataList.concat([createVersion(overrides)]);
        markChanged('versions');
        notify('versions');
    }

    /** 删除指定序号的版本。 */
    function removeVersion(index) {
        if (index < 0 || index >= state.versionDataList.length) return false;
        state.versionDataList = state.versionDataList.filter(function (_, i) {
            return i !== index;
        });
        markChanged('versions');
        notify('versions');
        return true;
    }

    /**
     * 更新某个版本的一个字段。
     * 注意：这里就地修改版本对象，并按字段性质决定变更类型：
     *  - 结构字段（scale / roleCount）：标记为 'versions'，重建规划卡片，
     *    否则弹窗里的徽标、「共N抽」、角色半场标签会停留在旧值；
     *  - 普通字段：标记为 'fields'，不重建版本列表 DOM，
     *    否则用户输入时会被打断（光标丢失）。
     */
    function updateVersionField(index, field, value) {
        var version = state.versionDataList[index];
        if (!version) return false;
        if (version[field] === value) return true;
        version[field] = value;

        if (STRUCTURAL_VERSION_FIELDS.indexOf(field) >= 0) {
            markChanged('versions');
        } else {
            markChanged('fields', field);
        }
        notify('versions');
        return true;
    }

    /** 清空版本列表。 */
    function clearVersions() {
        state.versionDataList = [];
        markChanged('versions');
        notify('versions');
    }

    /** 整体替换版本列表（读取缓存时使用）。 */
    function setVersionList(list) {
        state.versionDataList = list || [];
        markChanged('versions');
        notify('versions');
    }

    // ======================== 设置 ========================

    /**
     * 保存设置（默认抽数自动限制为 >= 1）。
     * 注意：默认抽数只影响之后新建的版本，已有版本保持原值。
     */
    function setSettings(partial) {
        if (partial.defaultLargePulls !== undefined) {
            state.settings.defaultLargePulls = Math.max(1, ZMD.util.toInt(partial.defaultLargePulls) || 104);
        }
        if (partial.defaultSmallPulls !== undefined) {
            state.settings.defaultSmallPulls = Math.max(1, ZMD.util.toInt(partial.defaultSmallPulls) || 73);
        }
        if (partial.resourcesCollapsed !== undefined) {
            state.settings.resourcesCollapsed = !!partial.resourcesCollapsed;
        }
        if (partial.arsenalPlanEnabled !== undefined) {
            state.settings.arsenalPlanEnabled = !!partial.arsenalPlanEnabled;
        }
        markChanged('settings');
        notify('settings');
    }

    function saveSettings() {
        storage.writeJSON(KEYS.SETTINGS, state.settings);
    }

    function loadSettings() {
        var saved = storage.readJSON(KEYS.SETTINGS);
        if (!saved) return;
        var defaults = defaultSettings();
        state.settings.defaultLargePulls = saved.defaultLargePulls == null ? defaults.defaultLargePulls : saved.defaultLargePulls;
        state.settings.defaultSmallPulls = saved.defaultSmallPulls == null ? defaults.defaultSmallPulls : saved.defaultSmallPulls;
        state.settings.resourcesCollapsed = saved.resourcesCollapsed == null ? defaults.resourcesCollapsed : !!saved.resourcesCollapsed;
        state.settings.arsenalPlanEnabled = saved.arsenalPlanEnabled == null ? defaults.arsenalPlanEnabled : !!saved.arsenalPlanEnabled;
    }

    // ======================== 持久化 ========================

    /** 把当前状态写入 localStorage。 */
    function save() {
        var resources = state.resources;
        storage.writeJSON(KEYS.PLANNER, {
            crystalJade: resources.crystalJade,
            guaranteeQuota: resources.guaranteeQuota,
            sourceStone: resources.sourceStone,
            arsenalQuota: resources.arsenalQuota,
            manualPulls: resources.manualPulls,
            includeSourceStone: resources.includeSourceStone,
            versionDataList: state.versionDataList
        });
    }

    /**
     * 从 localStorage 恢复状态。
     * @returns {boolean} 是否读到了有效缓存
     */
    function load() {
        var data = storage.readJSON(KEYS.PLANNER);
        if (!data || typeof data !== 'object') return false;

        var r = state.resources;
        r.crystalJade = data.crystalJade == null ? 0 : data.crystalJade;
        r.guaranteeQuota = data.guaranteeQuota == null ? 0 : data.guaranteeQuota;
        r.sourceStone = data.sourceStone == null ? 0 : data.sourceStone;
        r.arsenalQuota = data.arsenalQuota == null ? 0 : data.arsenalQuota;
        r.manualPulls = data.manualPulls == null ? 0 : data.manualPulls;
        r.includeSourceStone = data.includeSourceStone == null ? true : data.includeSourceStone;

        state.versionDataList = (data.versionDataList || []).map(migrateVersion);
        return true;
    }

    /** 清空全部数据并恢复出厂状态。 */
    function resetAll() {
        storage.remove(KEYS.PLANNER);
        storage.remove(KEYS.SETTINGS);
        state.resources = {
            crystalJade: 0,
            guaranteeQuota: 0,
            sourceStone: 0,
            arsenalQuota: 0,
            manualPulls: 0,
            includeSourceStone: true
        };
        state.versionDataList = [];
        state.settings = defaultSettings();
        // 全部区域都要重绘，否则清空后界面会残留旧数据
        markChanged('resources');
        markChanged('versions');
        markChanged('settings');
        notify('reset');
    }

    ZMD.store = {
        VERSION_DEFAULTS: VERSION_DEFAULTS,
        /** 修改后必须重建规划卡片的字段（规划模块据此与 store 保持一致） */
        STRUCTURAL_VERSION_FIELDS: STRUCTURAL_VERSION_FIELDS,
        subscribe: subscribe,
        getState: getState,
        notify: notify,
        consumeChangedKeys: consumeChangedKeys,
        createVersion: createVersion,
        setResource: setResource,
        addVersion: addVersion,
        removeVersion: removeVersion,
        updateVersionField: updateVersionField,
        clearVersions: clearVersions,
        setVersionList: setVersionList,
        setSettings: setSettings,
        saveSettings: saveSettings,
        loadSettings: loadSettings,
        save: save,
        load: load,
        resetAll: resetAll
    };
})(window.ZMD);
