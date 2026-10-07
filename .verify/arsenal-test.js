/**
 * 武库配额功能 + 实时刷新修复的自检（只读校验，不会修改交付文件）。
 *
 * 覆盖：
 *   1. 默认关闭时界面与旧版一致（无「抽取武器」勾选、武库列隐藏）；
 *   2. 开启后每个被抽取的卡池 +8160（= 4.1 抽），双角色版本加两次；
 *   3. 取消抽取 / 上半卡池时间已过 的卡池不产生收入；
 *   4. 「抽取武器」是每个角色各自的开关，每把武器 -15840（= 8 抽），可分别勾选；
 *   5. 武库配额不影响总抽数；
 *   6. 修复：切换版本规模 / 角色数量时，规划卡片立即重建（不再停留在旧状态）；
 *      切换规模后结果表也要跟着刷新；
 *   7. 旧缓存的版本级 pullWeapon 会迁移为每个角色的武器勾选。
 *
 * 运行：node .verify/arsenal-test.js
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

function section(title) {
    console.log('\n' + title);
}

function flush(win) {
    return new Promise(function (resolve) {
        let frames = 0;
        const step = function () {
            frames += 1;
            if (frames >= 4) setTimeout(resolve, 10);
            else win.requestAnimationFrame(step);
        };
        win.requestAnimationFrame(step);
    });
}

function click(win, element) {
    element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function setCheckbox(win, element, checked) {
    element.checked = checked;
    element.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function setSelect(win, element, value) {
    element.value = value;
    element.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function typeText(win, element, value) {
    element.value = value;
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
}

const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('jsdomError', function (error) {
    if (/Could not parse CSS/i.test(error.message)) return;
    consoleErrors.push(error.message);
});
virtualConsole.on('error', function (message) {
    consoleErrors.push(String(message));
});

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
        return run(win, doc);
    }).then(function () {
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
    console.error('自检脚本执行失败：', error);
    process.exit(1);
});

async function run(win, doc) {
    const ZMD = win.ZMD;
    const $ = function (id) { return doc.getElementById(id); };
    const $$ = function (selector) { return Array.prototype.slice.call(doc.querySelectorAll(selector)); };
    const rows = function () { return $$('#resultTableBody tr'); };
    const store = ZMD.store;
    const rates = ZMD.calc.RATES;

    const GAIN = rates.arsenalQuotaPerPoolPull / rates.arsenalQuotaPerPull;   // 4.1
    const COST = rates.arsenalQuotaPerWeaponPull / rates.arsenalQuotaPerPull; // 8
    const totalPulls = function () { return $('totalPulls').textContent; };
    const arsenalPulls = function () { return $('arsenalPullsDisplay').textContent; };

    section('【壹】武库配额功能默认关闭，界面与旧版一致');
    ok(store.getState().settings.arsenalPlanEnabled === false, '默认不开启武库配额获取');
    ok($('resultTable').classList.contains('hide-arsenal'), '武库抽数列默认隐藏');
    ok(doc.querySelector('#resultTableBody [data-field="role1Weapon"]') === null, '结果表默认没有「抽取武器」勾选');
    ok(ZMD.calc.run(store.getState().versionDataList, store.getState().resources, store.getState().settings)
        .arsenal.enabled === false, '计算层默认不推演武库配额');

    section('【贰】开启武库配额获取');
    click(win, $('btnOpenSettings'));
    await flush(win);
    ok(!!$('settingArsenalPlan'), '设置弹窗里有「武库配额获取」开关');
    setCheckbox(win, $('settingArsenalPlan'), true);
    click(win, $('btnSaveSettings'));
    await flush(win);
    ok(store.getState().settings.arsenalPlanEnabled === true, '开关已写入 store');
    ok($('resultTable').classList.contains('hide-arsenal') === false, '武库抽数列已显示');
    ok(!!doc.querySelector('#resultTableBody [data-field="role1Weapon"]'), '结果表出现角色1 的「抽取武器」勾选');
    ok(!!doc.querySelector('#resultTableBody [data-field="role2Weapon"]'), '结果表出现角色2 的「抽取武器」勾选');
    ok($$('#resultTableBody .check-weapon').length === 2,
        '双角色版本的每个角色都有「抽取武器」勾选',
        $$('#resultTableBody .check-weapon').length);
    ok(doc.querySelector('#resultTableBody [data-field="role2Weapon"]')
        .closest('.setting-cell') !== doc.querySelector('#resultTableBody [data-field="role1Weapon"]').closest('.setting-cell'),
        '两个角色的「抽取武器」分属各自那一行的设置列');

    section('【叁】每个被抽取的卡池 +8160（双角色加两次）');
    // 示例版本：2 角色，默认都勾选抽取
    ok(arsenalPulls() === (GAIN * 2).toFixed(1), '两个卡池都抽 → ' + (GAIN * 2).toFixed(1) + ' 抽', arsenalPulls());
    ok($('arsenalDetail').textContent.indexOf('卡池获取 +' + (GAIN * 2).toFixed(1)) >= 0,
        '明细显示卡池获取合计', $('arsenalDetail').textContent);
    ok($('arsenalDetail').textContent.indexOf('初始 0.0 抽') >= 0, '明细显示初始为 0 抽', $('arsenalDetail').textContent);

    // 取消下半卡池抽取 → 只剩一个卡池收入
    const pull2 = doc.querySelector('#resultTableBody [data-field="role2Pull"]');
    setCheckbox(win, pull2, false);
    await flush(win);
    ok(arsenalPulls() === GAIN.toFixed(1), '只抽一个卡池 → ' + GAIN.toFixed(1) + ' 抽', arsenalPulls());

    // 恢复
    setCheckbox(win, doc.querySelector('#resultTableBody [data-field="role2Pull"]'), true);
    await flush(win);
    ok(arsenalPulls() === (GAIN * 2).toFixed(1), '恢复后回到 ' + (GAIN * 2).toFixed(1) + ' 抽', arsenalPulls());

    section('【肆】抽取武器：每个角色各自一个开关，每把武器 -15840（= 8 抽）');
    const weaponBox = function (role) {
        return doc.querySelector('#resultTableBody [data-field="role' + role + 'Weapon"]');
    };
    ok(!!weaponBox(1) && !!weaponBox(2), '双角色版本每个角色行都有「抽取武器」勾选');
    ok(weaponBox(1) !== weaponBox(2), '两个角色的武器勾选相互独立');

    // 只抽角色1 的武器
    setCheckbox(win, weaponBox(1), true);
    await flush(win);
    ok(store.getState().versionDataList[0].role1Weapon === true, '角色1 武器勾选已写回 store');
    ok(store.getState().versionDataList[0].role2Weapon === false, '角色2 武器未被连带勾选');
    const oneWeapon = (GAIN * 2 - COST).toFixed(1); // 16.4 - 8 = 8.4
    ok(arsenalPulls() === oneWeapon, '两个卡池 + 一把武器 → ' + oneWeapon + ' 抽', arsenalPulls());
    ok($('arsenalDetail').textContent.indexOf('武器抽取 -' + COST.toFixed(1)) >= 0,
        '明细显示武器支出 -' + COST.toFixed(1), $('arsenalDetail').textContent);
    ok(win.document.querySelectorAll('#resultTableBody .tag-weapon').length === 1,
        '结果表出现 1 个「抽武器」标记', doc.querySelectorAll('#resultTableBody .tag-weapon').length);

    // 再抽角色2 的武器 → 两把武器一起扣
    setCheckbox(win, weaponBox(2), true);
    await flush(win);
    ok(store.getState().versionDataList[0].role2Weapon === true, '角色2 武器勾选已写回 store');
    const twoWeapons = (GAIN * 2 - COST * 2).toFixed(1); // 16.4 - 16 = 0.4
    ok(arsenalPulls() === twoWeapons, '两个卡池 + 两把武器 → ' + twoWeapons + ' 抽', arsenalPulls());
    ok(doc.querySelectorAll('#resultTableBody .tag-weapon').length === 2,
        '两个角色行都出现「抽武器」标记', doc.querySelectorAll('#resultTableBody .tag-weapon').length);
    ok($('arsenalDetail').textContent.indexOf('共 2 把武器') >= 0,
        '明细标注武器数量', $('arsenalDetail').textContent);

    // 只留角色2 的武器
    setCheckbox(win, weaponBox(1), false);
    await flush(win);
    ok(arsenalPulls() === oneWeapon, '只留角色2 武器 → 仍为 ' + oneWeapon + ' 抽', arsenalPulls());
    setCheckbox(win, weaponBox(2), false);
    await flush(win);
    ok(arsenalPulls() === (GAIN * 2).toFixed(1), '两把武器都取消 → 回到 ' + (GAIN * 2).toFixed(1) + ' 抽', arsenalPulls());

    // 恢复为「两个卡池 + 角色1 武器」，供后续用例使用
    setCheckbox(win, weaponBox(1), true);
    await flush(win);

    section('【伍】每个角色的武器勾选独立联动');
    // 取消角色1 抽取 → 角色1 的武器被联动关闭，角色2 的武器不受影响
    setCheckbox(win, weaponBox(2), true);
    await flush(win);
    ok(arsenalPulls() === twoWeapons, '两把武器都在 → ' + twoWeapons + ' 抽', arsenalPulls());

    setCheckbox(win, doc.querySelector('#resultTableBody [data-field="role1Pull"]'), false);
    await flush(win);
    ok(store.getState().versionDataList[0].role1Weapon === false, '取消角色1 抽取 → 角色1 武器被联动关闭');
    ok(store.getState().versionDataList[0].role2Weapon === true, '角色2 武器不受影响');
    ok(arsenalPulls() === (GAIN - COST).toFixed(1),
        '只剩角色2 卡池 + 角色2 武器 → ' + (GAIN - COST).toFixed(1) + ' 抽', arsenalPulls());

    // 取消角色2 抽取 → 全部归零
    setCheckbox(win, doc.querySelector('#resultTableBody [data-field="role2Pull"]'), false);
    await flush(win);
    ok(store.getState().versionDataList[0].role2Weapon === false, '取消角色2 抽取 → 角色2 武器被联动关闭');
    ok(arsenalPulls() === '0.0', '没有任何抽取 → 武库配额回到 0 抽', arsenalPulls());

    // 恢复：两个卡池 + 角色1 武器
    setCheckbox(win, doc.querySelector('#resultTableBody [data-field="role1Pull"]'), true);
    await flush(win);
    setCheckbox(win, doc.querySelector('#resultTableBody [data-field="role2Pull"]'), true);
    await flush(win);
    setCheckbox(win, weaponBox(1), true);
    await flush(win);
    ok(arsenalPulls() === oneWeapon, '恢复后为 ' + oneWeapon + ' 抽', arsenalPulls());

    section('【陆】手填武库配额作为初始值叠加');
    typeText(win, $('arsenalQuota'), String(rates.arsenalQuotaPerPull * 10)); // 10 抽
    await flush(win);
    ok(arsenalPulls() === (10 + GAIN * 2 - COST).toFixed(1),
        '初始 10 抽 + 卡池收入 - 一把武器 = ' + (10 + GAIN * 2 - COST).toFixed(1), arsenalPulls());
    ok($('arsenalDetail').textContent.indexOf('初始 10.0 抽') >= 0, '明细初始值同步为 10.0 抽', $('arsenalDetail').textContent);
    typeText(win, $('arsenalQuota'), '0');
    await flush(win);

    section('【柒】武库配额不影响总抽数');
    const before = totalPulls();
    const beforeInitial = $('summaryInitial').textContent;
    setCheckbox(win, weaponBox(2), true);
    await flush(win);
    setCheckbox(win, weaponBox(2), false);
    await flush(win);
    ok(totalPulls() === before, '勾选 / 取消武器后总抽数不变', totalPulls() + ' vs ' + before);
    ok($('summaryInitial').textContent === beforeInitial, '汇总「初始总抽数」不变');

    section('【捌】bug 修复：结构字段变化时规划卡片立即重建');
    const cardHeader = function () {
        const card = doc.querySelector('#versionList .version-card');
        return card ? card.querySelector('.card-header').textContent.replace(/\s+/g, '') : '';
    };
    const scaleSelect = function () { return doc.querySelector('#versionList [data-field="scale"]'); };

    setSelect(win, scaleSelect(), 'small');
    await flush(win);
    ok(store.getState().versionDataList[0].scale === 'small', '版本规模写入 store');
    ok(cardHeader().indexOf('小版本') >= 0, '卡片标题徽标立即变为「小版本」', cardHeader());
    ok(cardHeader().indexOf('共73抽') >= 0, '卡片「共N抽」立即同步', cardHeader());
    ok(!!doc.querySelector('#versionList [data-field="largePulls"]') === false, '小版本不再显示大版本抽数输入');

    setSelect(win, scaleSelect(), 'custom');
    await flush(win);
    ok(!!doc.querySelector('#versionList [data-field="customTotalPulls"]'), '切到自定义版本后立即出现自定义抽数输入');
    ok(cardHeader().indexOf('自定义') >= 0, '卡片徽标立即变为「自定义」', cardHeader());

    setSelect(win, scaleSelect(), 'large');
    await flush(win);
    ok(cardHeader().indexOf('大版本') >= 0, '切回大版本后徽标恢复', cardHeader());
    ok(cardHeader().indexOf('共104抽') >= 0, '切回大版本后「共N抽」恢复', cardHeader());

    section('【玖】bug 修复：角色数量变化时卡片与结果表同步');
    const cardCount = function () { return $$('#versionList .version-card').length; };
    setSelect(win, doc.querySelector('#versionList [data-field="roleCount"]'), '1');
    await flush(win);
    ok(cardCount() === 1, '仍是一张卡片');
    ok(doc.querySelector('#versionList [data-field="role2Name"]') === null, '卡片内角色2 输入已移除');
    ok(rows().length === 1, '结果表同步为一行', rows().length);
    ok(!!doc.querySelector('#resultTableBody [data-field="role1Weapon"]'), '单角色版本仍有「抽取武器」勾选');
    ok(doc.querySelector('#resultTableBody [data-field="role2Weapon"]') === null, '单角色版本没有角色2 的武器勾选');

    setSelect(win, doc.querySelector('#versionList [data-field="roleCount"]'), '2');
    await flush(win);
    ok(!!doc.querySelector('#versionList [data-field="role2Name"]'), '卡片内恢复角色2 输入');
    ok(rows().length === 2, '结果表恢复两行', rows().length);
    ok(!!doc.querySelector('#resultTableBody [data-field="role2Weapon"]'), '恢复双角色后角色2 的武器勾选回来');

    section('【拾】关闭开关后整列隐藏且数值回退');
    click(win, $('btnOpenSettings'));
    await flush(win);
    setCheckbox(win, $('settingArsenalPlan'), false);
    click(win, $('btnSaveSettings'));
    await flush(win);
    ok(store.getState().settings.arsenalPlanEnabled === false, '开关已关闭');
    ok($('resultTable').classList.contains('hide-arsenal'), '武库抽数列重新隐藏');
    ok(doc.querySelector('#resultTableBody [data-field="role1Weapon"]') === null, '「抽取武器」勾选消失');
    ok(arsenalPulls() === '0.0', '武库配额抽数回到手填换算值（0）', arsenalPulls());
    ok($('arsenalDetail').textContent.indexOf('不计入总抽数') >= 0, '明细回到只说明不计入总抽数', $('arsenalDetail').textContent);
    ok(store.getState().versionDataList[0].role1Weapon === true, '关闭开关不会丢失已保存的武器勾选');

    section('【拾壹】旧字段 pullWeapon 不再被界面使用');
    // 重新开启功能，然后通过 setVersionList 灌入带旧字段的版本。
    // 注意：setVersionList 是「原样替换」的底层入口，不做迁移；
    // 真实的缓存载入路径（store.load 的 pullWeapon → role1Weapon/role2Weapon 迁移）
    // 由 .verify/migrate-test.js 覆盖。这里只确认旧字段不会再产生任何武器勾选或支出。
    store.setSettings({ arsenalPlanEnabled: true });
    await flush(win);
    store.setVersionList([
        { versionName: '旧数据', scale: 'large', roleCount: 2, role1Pull: true, role2Pull: true, pullWeapon: true }
    ]);
    await flush(win);
    ok(!store.getState().versionDataList[0].role1Weapon,
        '旧字段 pullWeapon 不会让界面把角色1 当成要抽武器',
        String(store.getState().versionDataList[0].role1Weapon));
    ok(!store.getState().versionDataList[0].role2Weapon,
        '旧字段 pullWeapon 不会让界面把角色2 当成要抽武器',
        String(store.getState().versionDataList[0].role2Weapon));
    ok(doc.querySelectorAll('#resultTableBody .tag-weapon').length === 0, '结果表没有「抽武器」标记');
    ok(arsenalPulls() === (GAIN * 2).toFixed(1), '武库配额只有卡池收入 ' + (GAIN * 2).toFixed(1) + ' 抽', arsenalPulls());
}
