/**
 * 本地存储封装。
 *
 * 统一处理 localStorage 不可用（隐私模式、file:// 限制、配额已满）的情况，
 * 所有读写都返回结果而不是抛异常，调用方无需再包 try/catch。
 *
 * 存储键沿用旧版本，保证老用户数据不丢失。
 */
(function (ZMD) {
    'use strict';

    var KEYS = {
        /** 资源数据 + 版本规划 */
        PLANNER: 'arknights_endfield_planner_v2',
        /** 默认抽数设置 */
        SETTINGS: 'arknights_endfield_settings_v1',
        /** 主题偏好 */
        THEME: 'arknights_endfield_theme_v1'
    };

    /** 探测 localStorage 是否真的可写（部分浏览器仅是存在但写入即抛错）。 */
    var available = (function () {
        try {
            var probe = '__zmd_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    })();

    /** 内存兜底：localStorage 不可用时保证当前会话功能正常。 */
    var memory = {};

    /**
     * 读取并解析 JSON。
     * @param {string} key
     * @returns {*} 解析失败或不存在时返回 null
     */
    function readJSON(key) {
        var raw = null;
        try {
            raw = available ? window.localStorage.getItem(key) : (memory[key] || null);
        } catch (e) {
            raw = memory[key] || null;
        }
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[ZMD.storage] JSON 解析失败:', key, e);
            return null;
        }
    }

    /**
     * 序列化并写入。
     * @returns {boolean} 是否成功
     */
    function writeJSON(key, value) {
        var raw;
        try {
            raw = JSON.stringify(value);
        } catch (e) {
            console.warn('[ZMD.storage] 序列化失败:', key, e);
            return false;
        }
        memory[key] = raw;
        if (!available) return false;
        try {
            window.localStorage.setItem(key, raw);
            return true;
        } catch (e) {
            console.warn('[ZMD.storage] 保存失败:', key, e);
            return false;
        }
    }

    /**
     * 删除单个键。
     */
    function remove(key) {
        try {
            if (available) window.localStorage.removeItem(key);
        } catch (e) { /* 忽略 */ }
        delete memory[key];
    }

    /** 清空本应用占用的所有键（不影响同域其他数据）。 */
    function clearAll() {
        Object.keys(KEYS).forEach(function (name) {
            remove(KEYS[name]);
        });
    }

    ZMD.storage = {
        KEYS: KEYS,
        available: available,
        readJSON: readJSON,
        writeJSON: writeJSON,
        remove: remove,
        clearAll: clearAll
    };
})(window.ZMD);
