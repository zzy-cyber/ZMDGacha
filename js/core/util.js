/**
 * 通用工具函数：数值解析、DOM 查询与事件绑定。
 * 不依赖任何其他模块，可被任意模块使用。
 */
(function (ZMD) {
    'use strict';

    /**
     * 把输入框的值解析为整数。
     * 与原实现保持一致：用 parseInt 语义（"12.9" → 12），非法值为 0。
     * @param {string|number|null|undefined} value
     * @returns {number}
     */
    function toInt(value) {
        var n = parseInt(value, 10);
        return isNaN(n) ? 0 : n;
    }

    /**
     * 把输入框的值解析为浮点数。
     * @param {string|number|null|undefined} value
     * @param {number} [fallback=0]
     * @returns {number}
     */
    function toFloat(value, fallback) {
        var n = parseFloat(value);
        return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
    }

    /**
     * 限制在 [min, max] 区间内。
     */
    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * 保留固定小数位（返回字符串）。
     */
    function toFixed(value, digits) {
        return Number(value).toFixed(digits);
    }

    /**
     * 转义 HTML 特殊字符。
     * 仅用于必须拼接 HTML 字符串的场景（如 input 的 value 属性）；
     * 纯文本一律优先使用 textContent。
     */
    function escapeHTML(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** document.getElementById 的简写。 */
    function $(id) {
        return document.getElementById(id);
    }

    /** 在 root 内查询全部匹配元素，返回真数组。 */
    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    /**
     * 绑定事件并返回解绑函数，便于销毁或重建。
     * @returns {function(): void}
     */
    function on(target, type, handler, options) {
        if (!target) return function () {};
        target.addEventListener(type, handler, options);
        return function () {
            target.removeEventListener(type, handler, options);
        };
    }

    /** 同时绑定多个事件（如 input + change）。 */
    function onAll(target, types, handler, options) {
        var offs = types.map(function (type) {
            return on(target, type, handler, options);
        });
        return function () {
            offs.forEach(function (off) { off(); });
        };
    }

    ZMD.util = {
        toInt: toInt,
        toFloat: toFloat,
        clamp: clamp,
        toFixed: toFixed,
        escapeHTML: escapeHTML,
        $: $,
        $$: $$,
        on: on,
        onAll: onAll
    };
})(window.ZMD);
