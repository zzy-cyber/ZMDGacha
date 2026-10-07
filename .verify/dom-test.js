/**
 * 界面交互链路自检（只读校验，不会修改交付文件）。
 *
 * 用 jsdom 真实加载 index.html 与全部脚本，然后模拟用户操作，验证：
 *   1. 资源统计模块可收起 / 展开，且状态写入 store；
 *   2. 主页面不再渲染抽卡规划区，规划改为弹窗（由资源区按钮打开）；
 *   3. 「是否抽取 / 当日获取 / 上半卡池时间已过」在结果表中可勾选并生效；
 *   4. 结果表列结构（已移除「判断方式」列，行内单元格数与表头一致）；
 *   5. 版本名称可修改，并立即反映到结果表；
 *   6. 版本卡片不再包含上述勾选项。
 *
 * 运行：node .verify/dom-test.js
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

/** 等待若干帧，让 renderer 的合并刷新跑完 */
function flush(win) {
    return new Promise(function (resolve) {
        let frames = 0;
        const step = function () {
            frames += 1;
            if (frames >= 4) {
                setTimeout(resolve, 10);
            } else {
                win.requestAnimationFrame(step);
            }
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

    section('【0】应用是否正常启动');
    ok(!!ZMD && !!ZMD.store && !!ZMD.calc, 'ZMD 命名空间与各层已挂载');
    if (!ZMD || !ZMD.store) return;

    ok(ZMD.store.getState().versionDataList.length === 1, '首次访问写入了 1 个示例版本');

    section('【1】资源统计模块可收起 / 展开');
    const resourceSection = $('resource-section');
    const toggleBtn = $('btnToggleResources');
    ok(!!resourceSection && !!toggleBtn, '资源区与收起按钮存在');
    ok(resourceSection.classList.contains('is-collapsed') === false, '默认展开');
    ok(toggleBtn.getAttribute('aria-expanded') === 'true', 'aria-expanded 初始为 true');

    click(win, toggleBtn);
    await flush(win);
    ok(resourceSection.classList.contains('is-collapsed') === true, '点击后进入收起状态');
    ok(ZMD.store.getState().settings.resourcesCollapsed === true, '收起状态已写入 store（可持久化）');
    ok(toggleBtn.getAttribute('aria-expanded') === 'false', 'aria-expanded 同步为 false');

    click(win, toggleBtn);
    await flush(win);
    ok(resourceSection.classList.contains('is-collapsed') === false, '再次点击恢复展开');

    section('【2】抽卡规划改为弹窗');
    ok($('plan-section') === null, '主页面已不存在抽卡规划区（#plan-section）');
    const planOverlay = $('planOverlay');
    const openBtn = $('btnOpenPlan');
    ok(!!planOverlay && !!openBtn, '规划弹窗与入口按钮存在');
    ok(openBtn.closest('#resource-section') === resourceSection, '入口按钮位于抽卡资源统计模块内');
    ok(planOverlay.classList.contains('show') === false, '弹窗默认关闭');

    click(win, openBtn);
    await flush(win);
    ok(planOverlay.classList.contains('show') === true, '点击「📋 抽卡规划」后弹窗打开');

    click(win, $('btnClosePlan'));
    await flush(win);
    ok(planOverlay.classList.contains('show') === false, '关闭按钮可关闭弹窗');

    section('【3】版本卡片：可改名称、不再包含三个勾选项');
    const card = $('versionList').querySelector('.version-card');
    ok(!!card, '规划弹窗中渲染出示例版本卡片');
    ok(!!card.querySelector('[data-field="versionName"]'), '版本卡片有「版本名称」输入框');
    const cardText = card.textContent;
    ok(card.querySelectorAll('input[type="checkbox"]').length === 0, '卡片内已无任何勾选框（全部移到结果表）');
    ok(cardText.indexOf('是否抽取 / 当日获取请在') >= 0, '卡片内给出「请在计算结果中勾选」的指引');
    ok($('btnAddVersion').closest('#planOverlay') === planOverlay, '「添加版本」按钮已移入弹窗');

    section('【4】结果表勾选设置');
    const rows = function () { return $$('#resultTableBody tr'); };
    ok(rows().length === 2, '示例版本（2 角色）渲染出上半 / 下半两行', rows().length);

    // 列结构：已去掉「判断方式」列，避免表格过宽需要横向滚动
    const headers = $$('#resultTable thead th').map(function (th) { return th.textContent.trim(); });
    ok(headers.indexOf('判断方式') < 0, '表头已不含「判断方式」列', headers.join(' / '));
    ok(headers.length === 8, '表头共 8 列（步骤/角色/设置/半场抽数/判断时总抽数/结果/扣除后抽数/武库抽数）',
        headers.length + '：' + headers.join(' / '));
    ok(rows().every(function (tr) { return tr.children.length === 8; }),
        '每个数据行都有 8 个单元格（与表头列数一致）',
        rows().map(function (tr) { return tr.children.length; }).join(','));
    ok($('resultTableBody').querySelectorAll('.judgment-cell').length === 0,
        '行内已无「判断方式」单元格');

    const firstSettingCell = rows()[0].querySelector('.setting-cell');
    const lastSettingCell = rows()[1].querySelector('.setting-cell');
    const labelsOf = function (cell) {
        return Array.prototype.map.call(cell.querySelectorAll('.mini-check span'), function (n) { return n.textContent; });
    };
    ok(labelsOf(firstSettingCell).join('/') === '抽取/当日/上半卡池时间已过', '上半行提供 抽取 / 当日 / 上半卡池时间已过', labelsOf(firstSettingCell).join('/'));
    ok(labelsOf(lastSettingCell).join('/') === '抽取/当日', '下半行只提供 抽取 / 当日', labelsOf(lastSettingCell).join('/'));

    const pull1 = firstSettingCell.querySelector('[data-field="role1Pull"]');
    const day1 = firstSettingCell.querySelector('[data-field="role1DayOne"]');
    const skip1 = firstSettingCell.querySelector('[data-field="skipHalf1"]');
    ok(pull1.checked === true, '「抽取」默认勾选（沿用原有版本设置）');
    ok(day1.disabled === false, '勾选抽取时「当日」可用');

    // 取消抽取 → 计划抽取角色数 2 → 1，且当日被联动关闭
    setCheckbox(win, pull1, false);
    await flush(win);
    ok(ZMD.store.getState().versionDataList[0].role1Pull === false, '取消「抽取」已写回 store');
    ok($('summaryTargetCount').textContent === '1 个', '计划抽取角色数同步为 1', $('summaryTargetCount').textContent);
    const day1After = rows()[0].querySelector('[data-field="role1DayOne"]');
    ok(day1After.disabled === true, '不抽取时「当日」自动禁用');

    // 恢复抽取 + 勾选当日
    setCheckbox(win, rows()[0].querySelector('[data-field="role1Pull"]'), true);
    await flush(win);
    setCheckbox(win, rows()[0].querySelector('[data-field="role1DayOne"]'), true);
    await flush(win);
    ok(ZMD.store.getState().versionDataList[0].role1DayOne === true, '「当日」勾选已写回 store');
    ok(rows()[0].textContent.indexOf('当日获取') >= 0, '结果表出现「当日获取」标记');

    // 「上半卡池时间已过」
    setCheckbox(win, rows()[0].querySelector('[data-field="skipHalf1"]'), true);
    await flush(win);
    ok(ZMD.store.getState().versionDataList[0].skipHalf1 === true, '「上半卡池时间已过」已写回 store');
    const skippedRow = rows()[0];
    ok(skippedRow.className.indexOf('row-skipped') >= 0, '该行标记为已跳过');
    ok(skippedRow.textContent.indexOf('⏭️ 上半已过') >= 0, '结果列显示「⏭️ 上半已过」');
    ok(!!skippedRow.querySelector('.pull-cell-skipped'), '半场抽数显示为已失效样式');
    ok(skippedRow.querySelector('[data-field="role1Pull"]').disabled === true, '上半已过时该行「抽取」禁用');

    setCheckbox(win, rows()[0].querySelector('[data-field="skipHalf1"]'), false);
    await flush(win);
    ok(ZMD.store.getState().versionDataList[0].skipHalf1 === false, '取消后恢复参与计算');

    section('【5】版本名称修改立即反映到结果表');
    const nameInput = card.querySelector('[data-field="versionName"]');
    typeText(win, nameInput, '星尘版本');
    await flush(win);
    ok(ZMD.store.getState().versionDataList[0].versionName === '星尘版本', '名称已写回 store');
    ok(rows()[0].textContent.indexOf('星尘版本') >= 0, '结果表步骤列显示自定义名称', rows()[0].querySelector('.version-cell').textContent);
    ok(rows()[0].textContent.indexOf('（大版本）') >= 0, '名称后仍带版本规模');

    section('【6】清除缓存后界面同步');
    win.confirm = function () { return true; };
    click(win, $('btnClearCache'));
    await flush(win);
    ok(ZMD.store.getState().versionDataList.length === 0, '缓存已清空');
    ok($('resultTableBody').textContent.indexOf('暂无数据') >= 0, '结果表回到空状态');
    ok($('versionList').textContent.indexOf('暂无版本规划') >= 0, '版本列表回到空状态');
    ok($('totalPulls').textContent === '0', '总抽数归零');

    section('【7】默认抽数设置弹窗与增删版本');
    click(win, $('btnOpenSettings'));
    await flush(win);
    ok($('settingsOverlay').classList.contains('show') === true, '设置弹窗可打开（弹窗样式类已统一）');
    $('settingLargePulls').value = '150';
    $('settingSmallPulls').value = '80';
    click(win, $('btnSaveSettings'));
    await flush(win);
    ok($('settingsOverlay').classList.contains('show') === false, '保存后弹窗关闭');
    ok(ZMD.store.getState().settings.defaultLargePulls === 150, '大版本默认抽数已更新');

    click(win, $('btnAddVersion'));
    await flush(win);
    ok(ZMD.store.getState().versionDataList.length === 1, '「添加版本」可用（按钮在规划弹窗内）');
    ok(ZMD.store.getState().versionDataList[0].largePulls === 150, '新版本使用新的默认抽数');
    ok(rows().length === 1, '单角色版本只产生一行结果');
    ok(rows()[0].querySelector('.setting-cell').querySelectorAll('.mini-check').length === 2,
        '单角色版本没有「上半卡池时间已过」选项');

    click(win, $('versionList').querySelector('[data-action="delete-version"]'));
    await flush(win);
    ok(ZMD.store.getState().versionDataList.length === 0, '删除版本可用');
}
