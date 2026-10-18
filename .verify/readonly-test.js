/**
 * 只读模式自检（只读校验，不修改交付文件）。
 *
 * 把页面里的外链脚本内联后，用 https 地址加载，模拟线上访客：
 *   1. 不出现任何编辑入口（添加版本 / 编辑 / 删除 / 导出）；
 *   2. 显示「内容由站长发布」提示；
 *   3. 仍可勾选拥有状态，统计实时更新；
 *   4. 线上带 ?edit=1 时恢复编辑模式（站长备用入口）。
 *
 * 运行：node .verify/readonly-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'collection.html');

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
            if (frames >= 4) {
                setTimeout(resolve, 60);
            } else {
                win.requestAnimationFrame(step);
            }
        };
        win.requestAnimationFrame(step);
    });
}

/** 把 <script src> 换成内联脚本：jsdom 无法从 https 域名加载本地文件 */
function inlinePage() {
    const html = fs.readFileSync(PAGE, 'utf8');
    return html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, function (match, src) {
        const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
        return '<script>\n' + code + '\n</script>';
    });
}

async function boot(url) {
    const virtualConsole = new VirtualConsole();
    const errors = [];
    virtualConsole.on('jsdomError', function (error) {
        if (/Could not parse CSS/i.test(error.message)) return;
        errors.push(error.message);
    });

    const dom = new JSDOM(inlinePage(), {
        url: url,
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole: virtualConsole
    });

    const win = dom.window;
    const doc = win.document;

    await new Promise(function (resolve) {
        if (doc.readyState === 'complete') resolve();
        else win.addEventListener('load', resolve);
    });

    // 等启动流程把界面挂上
    await new Promise(function (resolve) {
        const deadline = Date.now() + 3000;
        const tick = function () {
            const ready = !!(win.ZMD && win.ZMD.ui && win.ZMD.ui.collection &&
                doc.querySelector('#collectionList .collection-empty'));
            if (ready || Date.now() > deadline) {
                resolve();
                return;
            }
            setTimeout(tick, 10);
        };
        tick();
    });

    return { dom: dom, win: win, doc: doc, errors: errors };
}

async function testReadonly() {
    const app = await boot('https://example.com/collection.html');
    const win = app.win;
    const doc = app.doc;
    const ZMD = win.ZMD;
    const $ = function (id) { return doc.getElementById(id); };

    section('【1】只读模式隐藏编辑入口');
    ok(!!ZMD && ZMD.ui && ZMD.ui.collection, '界面模块已挂载');
    ok(ZMD.ui.collection.canEdit() === false, 'canEdit 为 false');
    ok($('btnAddVersion').hidden === true, '「＋ 添加版本」按钮隐藏');
    ok($('btnExportCollection').hidden === true, '「导出发布包」按钮隐藏');
    ok($('btnImportCollection').hidden === true, '「导入」按钮隐藏');
    ok($('collectionPublishHint').hidden === true, '发布提示隐藏');
    ok($('collectionNotice').hidden === false, '只读提示可见');
    ok($('collectionList').textContent.indexOf('站长还没有发布收集清单') >= 0,
        '空状态提示改为「站长还没有发布收集清单」');

    section('【2】远端内容渲染后仍无编辑入口');
    await ZMD.collectionStore.applyRemote({
        schemaVersion: 2,
        publishedAt: '2026-10-18T00:00:00.000Z',
        versions: [{
            id: 'v_test',
            name: '2.1「星尘」',
            characters: [
                { id: 'c_alpha', name: '星辉', avatar: 'assets/collection/c_alpha-1.webp', weaponName: '星辉之刃' },
                { id: 'c_beta', name: '凛', avatar: '', weaponName: '' }
            ]
        }]
    });
    await flush(win);

    const rows = doc.querySelectorAll('#collectionList .roster-row');
    ok(rows.length === 2, '渲染出 2 行角色', rows.length);
    ok(doc.querySelectorAll('#collectionList [data-action]').length === 0, '没有添加 / 编辑 / 删除按钮');
    ok(doc.querySelectorAll('.roster-row-actions').length === 0, '没有行内操作列');
    ok(doc.querySelectorAll('#collectionList .own-check input').length === 4, '4 个拥有状态勾选框');

    section('【3】勾选仍然可用');
    const checkbox = doc.querySelector('#collectionList .roster-row[data-char="0"] input[data-field="owned"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
    await flush(win);

    ok(ZMD.collectionStore.getCharacter(0, 0).owned === true, '勾选写回 store');
    ok($('statCharOwned').textContent.trim() === '1', '角色拥有数实时更新', $('statCharOwned').textContent);
    ok($('statCharPercent').textContent.trim() === '50%', '角色拥有率为 50%', $('statCharPercent').textContent);

    ok(app.errors.length === 0, '页面运行期间没有未捕获错误', app.errors.join(' | '));
    app.dom.window.close();
}

async function testEditQuery() {
    const app = await boot('https://example.com/collection.html?edit=1');
    const win = app.win;
    const doc = app.doc;
    const $ = function (id) { return doc.getElementById(id); };

    section('【4】线上 ?edit=1 恢复编辑模式');
    ok(win.ZMD.ui.collection.canEdit() === true, 'canEdit 为 true');
    ok($('btnAddVersion').hidden === false, '「＋ 添加版本」可见');
    ok($('btnExportCollection').hidden === false, '「导出发布包」可见');
    ok($('collectionNotice').hidden === true, '只读提示隐藏');
    ok($('collectionPublishHint').hidden === false, '发布提示可见');
    ok(app.errors.length === 0, '页面运行期间没有未捕获错误', app.errors.join(' | '));
    app.dom.window.close();
}

(async function () {
    await testReadonly();
    await testEditQuery();

    console.log('\n———————————————————————————————');
    console.log(failures === 0
        ? '✅ 全部通过（' + checks + ' 项检查）'
        : '❌ 失败 ' + failures + ' / ' + checks + ' 项');
    process.exit(failures === 0 ? 0 : 1);
})().catch(function (error) {
    console.error('自检脚本执行失败：', error);
    process.exit(1);
});
