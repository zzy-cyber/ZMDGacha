/**
 * 主题管理：深色 / 浅色模式切换。
 *
 * 实现方式：在 <html> 上切换 data-theme="dark|light"，
 * 颜色全部来自 css/base.css 中的令牌，因此新增主题只需追加一组变量，无需改动 JS。
 *
 * 优先级：用户手动选择 > 系统偏好 > 默认深色（保持原有观感）。
 */
(function (ZMD) {
    'use strict';

    var storage = ZMD.storage;
    var util = ZMD.util;

    var THEMES = {
        dark: { icon: '🌙', text: '深色' },
        light: { icon: '☀️', text: '浅色' }
    };

    var DEFAULT_THEME = 'dark';
    /** 与 css/base.css 中 .theme-animating 的过渡时长保持一致 */
    var ANIMATION_MS = 260;

    var current = DEFAULT_THEME;
    /** 用户是否手动选择过主题；未选择过时跟随系统变化 */
    var userChosen = false;
    var animationTimer = null;
    var mediaQuery = null;

    function isValidTheme(theme) {
        return theme === 'dark' || theme === 'light';
    }

    /** 读取系统偏好。 */
    function systemTheme() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return 'light';
            }
        } catch (e) { /* 忽略 */ }
        return 'dark';
    }

    /** 决定初始主题。 */
    function resolveInitialTheme() {
        var saved = storage.readJSON(storage.KEYS.THEME);
        if (saved && isValidTheme(saved.theme)) {
            userChosen = true;
            return saved.theme;
        }
        // 兼容内联启动脚本已经写好的 data-theme
        var preset = document.documentElement.getAttribute('data-theme');
        if (isValidTheme(preset)) return preset;

        return systemTheme();
    }

    /**
     * 应用主题。
     * @param {string} theme
     * @param {boolean} [animate=true] 是否播放过渡动画
     */
    function apply(theme, animate) {
        if (!isValidTheme(theme)) theme = DEFAULT_THEME;
        var root = document.documentElement;

        if (animate !== false && current !== theme) {
            // 切换瞬间关闭过渡，避免旧配色残影；下一帧再开启配色过渡
            root.style.setProperty('--theme-transition', '0s');
            root.classList.add('theme-animating');

            requestAnimationFrame(function () {
                root.style.setProperty('--theme-transition', ANIMATION_MS + 'ms');
            });

            if (animationTimer) clearTimeout(animationTimer);
            animationTimer = setTimeout(function () {
                root.classList.remove('theme-animating');
                root.style.removeProperty('--theme-transition');
                animationTimer = null;
            }, ANIMATION_MS);
        }

        root.setAttribute('data-theme', theme);
        current = theme;
        updateToggleButton();
    }

    /** 同步切换按钮的状态（图标显隐由 CSS 按 data-theme 控制）。 */
    function updateToggleButton() {
        var button = util.$('btnThemeToggle');
        if (!button) return;
        var next = current === 'dark' ? 'light' : 'dark';
        button.setAttribute('title', '切换到' + THEMES[next].text + '模式');
        button.setAttribute('aria-pressed', current === 'light' ? 'true' : 'false');
    }

    /** 切换主题（并记住用户选择）。 */
    function toggle() {
        set(current === 'dark' ? 'light' : 'dark', true);
    }

    /**
     * 设置主题。
     * @param {string} theme
     * @param {boolean} [remember=true] 是否记为用户选择
     */
    function set(theme, remember) {
        if (!isValidTheme(theme)) return;
        if (remember !== false) {
            userChosen = true;
            storage.writeJSON(storage.KEYS.THEME, { theme: theme });
        }
        apply(theme, true);
    }

    function get() {
        return current;
    }

    /** 跟随系统主题变化（仅当用户没有手动选择时）。 */
    function bindSystemPreference() {
        if (!window.matchMedia) return;
        mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        var handler = function () {
            if (!userChosen) apply(systemTheme(), true);
        };
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handler);
        } else if (mediaQuery.addListener) {
            mediaQuery.addListener(handler);
        }
    }

    /** 初始化：应用主题并绑定按钮。 */
    function init() {
        current = resolveInitialTheme();
        apply(current, false);
        bindSystemPreference();

        util.on(util.$('btnThemeToggle'), 'click', toggle);
    }

    ZMD.theme = {
        init: init,
        get: get,
        set: set,
        toggle: toggle,
        apply: apply
    };
})(window.ZMD);
