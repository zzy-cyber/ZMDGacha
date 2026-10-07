/**
 * 应用启动入口。
 *
 * 启动顺序：
 *   1. 恢复设置与本地缓存（没有缓存时写入一份示例规划，保持原有「开箱可见」的体验）；
 *   2. 各界面模块挂载（只负责绑定事件，不主动重绘）；
 *   3. renderer 做首次渲染并开始订阅数据变化；
 *   4. 注册定时保存与页面关闭前保存。
 */
(function (ZMD) {
    'use strict';

    var store = ZMD.store;

    /** 自动保存间隔，避免每次输入都写 localStorage。 */
    var AUTO_SAVE_INTERVAL = 5000;

    /** 首次访问时展示的示例规划。 */
    var EXAMPLE_VERSION = {
        versionName: '示例版本',
        scale: 'large',
        roleCount: 2,
        role1Name: '示例角色A',
        role1Pull: true,
        role1DayOne: false,
        role2Name: '示例角色B',
        role2Pull: true,
        role2DayOne: false
    };

    /**
     * 界面模块清单，按数组顺序 init。
     * 新增模块时在这里追加一行即可，无需改动其他代码。
     */
    var UI_MODULES = [
        ZMD.ui.resources,
        ZMD.ui.plan,
        ZMD.ui.planModal,
        ZMD.ui.results,
        ZMD.ui.settingsModal,
        ZMD.ui.pageActions
    ];

    /** 主题需要最先应用，避免页面闪一下旧配色。 */
    function initTheme() {
        if (ZMD.theme && ZMD.theme.init) ZMD.theme.init();
    }

    /** 恢复数据；首次访问时写入示例版本。 */
    function initData() {
        store.loadSettings();
        var hasCache = store.load();

        if (!hasCache) {
            store.addVersion(EXAMPLE_VERSION);
            store.save();
        }
    }

    function initModules() {
        UI_MODULES.forEach(function (module) {
            if (module && typeof module.init === 'function') module.init();
        });
    }

    /** 定时保存 + 关闭页面前保存。 */
    function initPersistence() {
        setInterval(store.save, AUTO_SAVE_INTERVAL);

        window.addEventListener('beforeunload', function () {
            store.save();
        });

        // 切到后台时补存一次，避免移动端直接划掉页面导致丢数据
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') store.save();
        });
    }

    /** 在控制台输出当前规则，便于排查与二次开发。 */
    function logReady() {
        var settings = store.getState().settings;
        var rates = ZMD.calc.RATES;

        console.log('💠 明日方舟：终末地 - 抽卡资源统计与规划工具 已就绪');
        console.log('   - 默认抽数：大版本' + settings.defaultLargePulls + '抽 | 小版本' + settings.defaultSmallPulls + '抽（可在右上角设置中修改）');
        console.log('   - 资源统计：嵌晶玉(' + rates.crystalJadePerPull + '/抽) | 保障配额(' + rates.guaranteeQuotaPerPull +
            '/抽) | 衍质源石((x-' + rates.sourceStoneFree + ')×' + rates.sourceStonePulls + '÷' + rates.sourceStonePerPull +
            ') | 武库配额(÷' + rates.arsenalQuotaPerPull + '，不计入总抽) | 手动抽数(直接加减)');
        console.log('   - 双角色按 ' + Math.round(rates.firstHalfRatio * 100) + '%:' + (100 - Math.round(rates.firstHalfRatio * 100)) +
            '% 比例分配上下半，上半向下取整，小数点抽数归下半');
        console.log('   - 每角色需' + rates.pullsPerRole + '抽 | 支持当日获取模式 | 数据自动缓存至 localStorage');
        console.log('   - 武库配额获取：' + (settings.arsenalPlanEnabled ? '已开启' : '已关闭') +
            '（每个被抽取的卡池 +' + rates.arsenalQuotaPerPoolPull + ' 配额，抽取武器 -' + rates.arsenalQuotaPerWeaponPull +
            ' 配额，' + rates.arsenalQuotaPerPull + ' 配额 = 1 抽，不计入总抽数；可在右上角设置中开关）');
        console.log('   - 抽卡规划在「📋 抽卡规划」弹窗中编辑；是否抽取 / 当日获取 / 上半卡池时间已过 / 抽取武器请在「计算结果」中勾选');
    }

    function start() {
        initTheme();
        initData();
        initModules();
        ZMD.renderer.init();
        initPersistence();
        logReady();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})(window.ZMD);
