/**
 * 旧缓存兼容自检：验证「改造前」的缓存数据能被正确读取与迁移
 * （版本级 pullWeapon → 每个角色的 role1Weapon / role2Weapon）。
 *
 * 为什么这样写：jsdom 下 file:// 属于不透明源，localStorage 直接不可用
 * （真实浏览器不受影响）。此时 js/core/storage.js 会自动降级到内存兜底，
 * 所以这里用 ZMD.store.save() 把一份「旧结构」的数据写进缓存，
 * 再调用 ZMD.store.loadSettings() / load() —— 与页面启动完全同一条路径 ——
 * 检查迁移结果。
 *
 * 运行：node .verify/migrate-test.js
 */
'use strict';

const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');
const fileUrl = 'file:///' + INDEX.replace(/\\/g, '/');

let failures = 0;
let checks = 0;

function ok(condition, label, extra) {
    checks += 1;
    if (condition) {
        console.log('  ✅ ' + label);
    } else {
        failures += 1;
        console.log('  ❌ ' + label + (extra === undefined ? '' : '  → ' + extra));
    }
}

/** 旧版（本次改造前）的真实版本结构：只有版本级 pullWeapon。 */
const LEGACY_VERSIONS = [
    { versionName: '旧A', scale: 'large', roleCount: 2, role1Pull: true, role2Pull: false, pullWeapon: true, versionIncome: 20 },
    { versionName: '旧B', scale: 'small', roleCount: 2, role1Pull: false, role2Pull: true, pullWeapon: true },
    { versionName: '旧C', scale: 'large', roleCount: 1, role1Pull: true, pullWeapon: false },
    { versionName: '旧D', scale: 'custom', roleCount: 2, role1Pull: true, role2Pull: true }
];

const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('jsdomError', function (error) {
    if (/Could not parse CSS/i.test(error.message)) return;
    consoleErrors.push(error.message);
});
virtualConsole.on('error', function (message) { consoleErrors.push(String(message)); });

JSDOM.fromFile(INDEX, {
    url: fileUrl,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole
}).then(function (dom) {
    const win = dom.window;
    const doc = win.document;

    return new Promise(function (resolve) {
        if (doc.readyState === 'complete') resolve();
        else win.addEventListener('load', resolve);
    }).then(function () {
        const ZMD = win.ZMD;
        const store = ZMD.store;
        const storage = ZMD.storage;

        // 1) 用真实保存路径写入「旧结构」数据（缺 role1Weapon / role2Weapon / arsenalPlanEnabled）
        store.setVersionList(LEGACY_VERSIONS.map(function (v) { return Object.assign({}, v); }));
        store.setResource('crystalJade', 3000);
        store.setResource('guaranteeQuota', 100);
        store.setResource('sourceStone', 100);
        store.setResource('arsenalQuota', 3960);
        store.setResource('manualPulls', -5);
        store.getState().settings.defaultLargePulls = 120;
        store.getState().settings.defaultSmallPulls = 80;
        store.getState().settings.arsenalPlanEnabled = undefined;
        store.save();
        store.saveSettings();

        // 取出缓存里的原始 JSON（与重新打开页面时读到的一模一样）
        // 旧设置里没有 arsenalPlanEnabled 字段，收起状态为 true
        const rawSettings = storage.readJSON(storage.KEYS.SETTINGS);
        rawSettings.resourcesCollapsed = true;
        delete rawSettings.arsenalPlanEnabled;
        const rawPlanner = JSON.parse(JSON.stringify(storage.readJSON(storage.KEYS.PLANNER) || null));
        ok(rawPlanner && rawPlanner.versionDataList.length === 4, '测试数据已写入缓存（4 个版本）');
        ok(rawPlanner.versionDataList[0].role1Weapon === undefined,
            '缓存里的旧数据确实没有 role1Weapon 字段');

        // 2) 清空内存状态，模拟「重新打开页面」
        store.resetAll();
        ok(store.getState().versionDataList.length === 0, 'resetAll 后状态已清空');

        // 3) 重新写入刚才的旧缓存，再走启动时的载入路径
        storage.writeJSON(storage.KEYS.PLANNER, rawPlanner);
        storage.writeJSON(storage.KEYS.SETTINGS, rawSettings);
        ok(storage.readJSON(storage.KEYS.PLANNER).versionDataList.length === 4, '旧缓存已重新写入');
        ok(storage.readJSON(storage.KEYS.SETTINGS).arsenalPlanEnabled === undefined,
            '旧设置里确实没有 arsenalPlanEnabled 字段');

        store.loadSettings();
        const loaded = store.load();
        ZMD.renderer.renderAll(true);

        const list = store.getState().versionDataList;
        const settings = store.getState().settings;

        console.log('\n【旧缓存载入与迁移】');
        ok(loaded === true, 'store.load() 成功读到旧缓存');
        ok(list.length === 4, '4 个旧版本全部载入', list.length);
        ok(settings.arsenalPlanEnabled === false, '新增的武库配额开关补为默认关闭');

        ok(list[0].role1Weapon === true && list[0].role2Weapon === false,
            '旧A（勾了武器，只抽角色1）→ 仅角色1 带武器',
            JSON.stringify([list[0].role1Weapon, list[0].role2Weapon]));
        ok(list[1].role1Weapon === false && list[1].role2Weapon === true,
            '旧B（勾了武器，只抽角色2）→ 仅角色2 带武器',
            JSON.stringify([list[1].role1Weapon, list[1].role2Weapon]));
        ok(list[2].role1Weapon === false,
            '旧C（未勾武器，单角色）→ 角色1 不带武器', String(list[2].role1Weapon));
        ok(list[3].role1Weapon === false && list[3].role2Weapon === false,
            '旧D（未勾武器，双角色）→ 两个角色都不带武器',
            JSON.stringify([list[3].role1Weapon, list[3].role2Weapon]));

        ok(list.every(function (v) { return v.pullWeapon === undefined; }), '旧字段 pullWeapon 已清理');
        ok(list[0].versionIncome === 20, '已有字段值原样保留（versionIncome）', String(list[0].versionIncome));
        ok(list[2].role2Name === '' && list[2].role2Pull === true, '缺失字段按默认值补齐');

        console.log('\n【旧资源数据未受影响】');
        ok(store.getState().resources.crystalJade === 3000 && store.getState().resources.manualPulls === -5,
            '资源数量原样恢复');
        ok(doc.getElementById('totalPulls').textContent === '15',
            '总抽数 = 6(嵌晶玉) + 4(保障配额) + 10(衍质源石) + (-5)(手动) = 15（版本收入在结果表里逐步累加）',
            doc.getElementById('totalPulls').textContent);
        ok(doc.getElementById('arsenalPullsDisplay').textContent === '2.0',
            '未开启功能时武库配额仍是手填换算值 2.0',
            doc.getElementById('arsenalPullsDisplay').textContent);

        console.log('\n【旧设置未受影响】');
        ok(settings.defaultLargePulls === 120 && settings.defaultSmallPulls === 80, '默认抽数沿用旧值');
        ok(settings.resourcesCollapsed === true, '资源区收起状态沿用旧值（旧缓存里为 true）');
        ok(doc.getElementById('resource-section').classList.contains('is-collapsed'), '收起状态已应用到界面');

        console.log('\n【迁移后开启功能仍能正常推演】');
        store.setSettings({ arsenalPlanEnabled: true });
        ZMD.renderer.cancelPending();
        ZMD.renderer.renderAll(true);
        // 旧A：抽角色1（带武器）→ +4.1 -8 = -3.9
        // 旧B：抽角色2（带武器）→ +4.1 -8 = -3.9
        // 旧C：抽角色1（无武器）→ +4.1
        // 旧D：两个都抽（无武器）→ +8.2
        // 初始 2.0 → 2.0 -3.9 -3.9 +4.1 +8.2 = 6.5
        ok(doc.getElementById('arsenalPullsDisplay').textContent === '6.5',
            '迁移后的武器勾选正常参与推演（初始 2.0 → 6.5）',
            doc.getElementById('arsenalPullsDisplay').textContent);
        ok(win.document.querySelectorAll('#resultTableBody .tag-weapon').length === 2,
            '结果表出现 2 个「抽武器」标记（旧A / 旧B 各一个）',
            doc.querySelectorAll('#resultTableBody .tag-weapon').length);

        console.log('\n———————————————————————————————');
        if (consoleErrors.length) {
            console.log('⚠️ 页面运行时错误 ' + consoleErrors.length + ' 条：');
            consoleErrors.forEach(function (message) { console.log('   - ' + message); });
        }
        console.log(failures === 0
            ? '✅ 全部通过（' + checks + ' 项检查）'
            : '❌ 失败 ' + failures + ' / ' + checks + ' 项');
        dom.window.close();
        process.exit(failures === 0 && consoleErrors.length === 0 ? 0 : 1);
    });
}).catch(function (error) {
    console.error('自检脚本执行失败：', error && error.message);
    console.error(error && error.stack);
    process.exit(1);
});
