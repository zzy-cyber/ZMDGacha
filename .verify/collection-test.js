/**
 * 收集统计页自检（只读校验，不会修改交付文件）。
 *
 * 用 jsdom 真实加载 collection.html 与全部脚本，模拟用户操作，验证：
 *   1. 「添加版本」只以弹窗形式出现，主页不显示编辑区；
 *   2. 主页按「一行一个角色 + 一把专武」展示，角色和武器在同一行，下一角色在下一行；
 *   3. 拥有角色 / 专武的勾选在主页行内，实时更新角色拥有率与专武持有率；
 *   4. 专武持有率只在已拥有角色中统计（未拥有角色的专武不计入分母）；
 *   5. 三个筛选（全部 / 拥有 / 未拥有）可切换并正确过滤；
 *   6. 编辑弹窗可修改版本名、追加角色；图片上传 → 保存 → 主页显示；
 *   7. 图片尺寸预设为 456×564 / 256×256，数据可序列化，主题与页面入口正常。
 *
 * 运行：node .verify/collection-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PAGE = path.join(__dirname, '..', 'collection.html');
const INDEX_PAGE = path.join(__dirname, '..', 'index.html');
const fileUrl = 'file:///' + PAGE.replace(/\\/g, '/');

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

/** 等待若干帧，让界面刷新与 setTimeout 跑完 */
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

function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
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

function isShown(element) {
    return !!element && element.classList.contains('show');
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

JSDOM.fromFile(PAGE, {
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
    const text = function (id) {
        const node = $(id);
        return node ? node.textContent.trim() : '(缺少#' + id + ')';
    };
    const rows = function () { return $$('#collectionList .roster-row'); };

    section('【0】页面正常启动');
    ok(!!ZMD && !!ZMD.collectionStore && !!ZMD.collectionCalc && !!ZMD.imageUtil,
        'ZMD 收集统计各层已挂载');
    if (!ZMD || !ZMD.collectionStore) return;

    const store = ZMD.collectionStore;
    ok(store.getState().versions.length === 0, '首次访问为空数据（不伪造示例角色）');
    ok(!!$('collectionList').querySelector('.collection-empty'), '空状态提示存在');
    ok(text('statCharPercent') === '0%', '角色拥有率初始为 0%', text('statCharPercent'));
    ok(text('statWeaponPercent') === '0%', '专武持有率初始为 0%', text('statWeaponPercent'));

    ok(ZMD.imageUtil.PRESETS.avatar.width === 456 && ZMD.imageUtil.PRESETS.avatar.height === 564,
        '角色头像预设为 456×564',
        ZMD.imageUtil.PRESETS.avatar.width + '×' + ZMD.imageUtil.PRESETS.avatar.height);
    ok(ZMD.imageUtil.PRESETS.weapon.width === 256 && ZMD.imageUtil.PRESETS.weapon.height === 256,
        '武器图片预设为 256×256（正方形）',
        ZMD.imageUtil.PRESETS.weapon.width + '×' + ZMD.imageUtil.PRESETS.weapon.height);

    ok(!isShown($('editorOverlay')), '添加 / 编辑弹窗默认关闭');
    ok($$('#collectionList input[type="text"]').length === 0, '主页不显示任何信息输入框（只用于展示与勾选）');

    section('【1】通过弹窗添加版本与角色');
    click(win, $('btnAddVersion'));
    await flush(win);
    ok(isShown($('editorOverlay')), '点击「＋ 添加版本」打开填写弹窗');
    ok($('editorTitle').textContent.indexOf('添加版本') >= 0, '弹窗标题为「添加版本」');
    ok($$('#editorChars .editor-char').length === 1, '弹窗默认提供一个角色编辑块');

    typeText(win, $('editorVersionName'), '1.0 测试版本');
    const firstChar = doc.querySelector('#editorChars .editor-char[data-char="0"]');
    typeText(win, firstChar.querySelector('[data-field="name"]'), '测试角色A');
    typeText(win, firstChar.querySelector('[data-field="weaponName"]'), '武器A');

    click(win, $('btnEditorAddChar'));
    await flush(win);
    ok($$('#editorChars .editor-char').length === 2, '弹窗内可继续「＋ 添加角色」');
    const secondChar = doc.querySelector('#editorChars .editor-char[data-char="1"]');
    typeText(win, secondChar.querySelector('[data-field="name"]'), '测试角色B');
    typeText(win, secondChar.querySelector('[data-field="weaponName"]'), '武器B');

    click(win, $('btnSaveEditor'));
    await flush(win);
    ok(!isShown($('editorOverlay')), '保存后弹窗关闭');
    ok(store.getState().versions.length === 1, '保存后 store 中有 1 个版本');
    ok(store.getState().versions[0].name === '1.0 测试版本', '版本名称已保存');
    ok(store.getState().versions[0].characters.length === 2, '两个角色已保存');
    ok(store.getState().versions[0].characters[0].name === '测试角色A' &&
        store.getState().versions[0].characters[1].name === '测试角色B', '角色名称已保存');

    section('【2】主页清单：一行一个角色 + 一把专武');
    ok($$('#collectionList .version-group').length === 1, '主页渲染出 1 个版本分组');
    ok(rows().length === 2, '两个角色渲染成两行（下一角色在下一行）');
    ok(rows().every(function (row) {
        return row.querySelectorAll('.roster-character').length === 1 &&
            row.querySelectorAll('.roster-weapon').length === 1;
    }), '每一行都包含一个角色与一把专武');
    ok(rows().every(function (row) { return row.querySelector('.roster-character').nextElementSibling === row.querySelector('.roster-divider'); }),
        '角色与专武在同一行、由分隔线隔开');
    ok($$('#collectionList input[type="text"]').length === 0, '主页清单里没有名称输入框（名称只读展示）');
    ok(rows()[0].textContent.indexOf('测试角色A') >= 0 && rows()[0].textContent.indexOf('武器A') >= 0,
        '第一行显示角色A与武器A');
    ok(rows()[1].textContent.indexOf('测试角色B') >= 0, '第二行显示角色B');

    section('【3】主页行内勾选拥有状态并实时统计');
    const ownedA = rows()[0].querySelector('[data-field="owned"]');
    setCheckbox(win, ownedA, true);
    await flush(win);
    ok(store.getState().versions[0].characters[0].owned === true, '「拥有角色」已写回 store');
    ok(text('statCharOwned') === '1' && text('statCharTotal') === '2', '角色拥有率为 1/2',
        text('statCharOwned') + '/' + text('statCharTotal'));
    ok(text('statCharPercent') === '50%', '角色拥有率为 50%', text('statCharPercent'));
    ok($$('.version-stat')[0].textContent.indexOf('1/2') >= 0, '版本标题同步显示 1/2');
    ok(rows()[0].classList.contains('is-owned'), '已拥有角色所在行高亮');

    const weaponA = rows()[0].querySelector('[data-field="weaponOwned"]');
    setCheckbox(win, weaponA, true);
    await flush(win);
    ok(store.getState().versions[0].characters[0].weaponOwned === true, '「拥有专武」已写回 store');
    ok(text('statWeaponOwned') === '1' && text('statWeaponBase') === '1', '专武持有率为 1/1',
        text('statWeaponOwned') + '/' + text('statWeaponBase'));
    ok(text('statWeaponPercent') === '100%', '专武持有率为 100%', text('statWeaponPercent'));

    section('【4】筛选项：全部 / 拥有 / 未拥有');
    const filterButtons = $$('.filter-btn');
    const labels = filterButtons.map(function (b) { return b.textContent.replace(/\s+/g, ' ').trim(); });
    ok(labels.length === 3 &&
        labels[0].indexOf('全部角色') === 0 &&
        labels[1].indexOf('拥有角色') === 0 &&
        labels[2].indexOf('未拥有角色') === 0,
        '筛选项为「全部角色 / 拥有角色 / 未拥有角色」', labels.join(' | '));
    ok(labels[0].indexOf('2') >= 0 && labels[1].indexOf('1') >= 0 && labels[2].indexOf('1') >= 0,
        '筛选按钮带实时数量', labels.join(' | '));

    click(win, filterButtons[1]);
    await flush(win);
    ok(store.getState().filter === 'owned', '筛选状态写入 store');
    ok(filterButtons[1].getAttribute('aria-pressed') === 'true', '当前筛选项 aria-pressed 为 true');
    ok(rows().length === 1 && rows()[0].textContent.indexOf('测试角色A') >= 0,
        '「拥有角色」只显示已拥有的角色A');

    click(win, filterButtons[2]);
    await flush(win);
    ok(store.getState().filter === 'unowned', '筛选切到未拥有');
    ok(rows().length === 1 && rows()[0].textContent.indexOf('测试角色B') >= 0,
        '「未拥有角色」只显示未拥有的角色B');

    click(win, filterButtons[0]);
    await flush(win);
    ok(rows().length === 2, '「全部角色」显示两行');

    section('【5】专武持有率只在已拥有角色中统计');
    // 取消角色A的拥有（A 有专武），角色B未拥有：分母为 0
    setCheckbox(win, rows()[0].querySelector('[data-field="owned"]'), false);
    await flush(win);
    ok(text('statWeaponOwned') === '0' && text('statWeaponBase') === '0',
        '没有已拥有角色时专武持有率为 0/0',
        text('statWeaponOwned') + '/' + text('statWeaponBase'));

    // 勾选角色B（B 没有专武）：分母 1、分子 0
    setCheckbox(win, rows()[1].querySelector('[data-field="owned"]'), true);
    await flush(win);
    ok(text('statWeaponOwned') === '0' && text('statWeaponBase') === '1',
        '未拥有角色的专武不进入分子 / 分母（0/1）',
        text('statWeaponOwned') + '/' + text('statWeaponBase'));
    ok(text('statWeaponPercent') === '0%', '专武持有率显示 0%');
    ok(text('statMeta').indexOf('其中 0 把属于已拥有角色') >= 0,
        '总览说明区分「已拥有专武」与「属于已拥有角色的专武」', text('statMeta'));

    // 恢复：A 拥有 + 专武，B 不拥有，便于后续测试
    setCheckbox(win, rows()[1].querySelector('[data-field="owned"]'), false);
    await flush(win);
    setCheckbox(win, rows()[0].querySelector('[data-field="owned"]'), true);
    await flush(win);
    ok(text('statWeaponPercent') === '100%', '恢复后专武持有率回到 100%');

    section('【6】编辑弹窗：修改版本名 / 追加角色 / 取消不保存');
    click(win, doc.querySelector('.version-head [data-action="edit-version"]'));
    await flush(win);
    ok(isShown($('editorOverlay')), '「编辑」打开同一个弹窗');
    ok($('editorTitle').textContent.indexOf('编辑版本') >= 0, '弹窗标题切换为「编辑版本」');
    ok($('editorVersionName').value === '1.0 测试版本', '弹窗预填已有版本名');
    ok($$('#editorChars .editor-char').length === 2, '弹窗预填已有两个角色');
    ok(rows()[0].querySelector('[data-field="owned"]').checked === true,
        '已有拥有状态保留（离开弹窗后仍在主页勾选）');

    typeText(win, $('editorVersionName'), '不会保存的名字');
    click(win, $('btnCancelEditor'));
    await flush(win);
    ok(!isShown($('editorOverlay')), '取消后弹窗关闭');
    ok(store.getState().versions[0].name === '1.0 测试版本', '取消不会写入版本名');

    click(win, doc.querySelector('.version-head [data-action="edit-version"]'));
    await flush(win);
    typeText(win, $('editorVersionName'), '1.1 修订版');
    click(win, $('btnSaveEditor'));
    await flush(win);
    ok(store.getState().versions[0].name === '1.1 修订版', '编辑后的版本名已保存');
    ok($$('.version-title')[0].textContent.indexOf('1.1 修订版') >= 0, '主页版本标题同步更新');

    click(win, doc.querySelector('.version-head [data-action="add-character"]'));
    await flush(win);
    ok($$('#editorChars .editor-char').length === 3, '版本标题的「＋ 添加角色」会追加一个角色编辑块');
    typeText(win, doc.querySelector('#editorChars .editor-char[data-char="2"] [data-field="name"]'), '测试角色C');
    click(win, $('btnSaveEditor'));
    await flush(win);
    ok(store.getState().versions[0].characters.length === 3, '第三个角色已保存');
    ok(rows().length === 3, '主页变成三行（一行一个角色）');

    section('【7】图片上传（弹窗内处理，保存后主页显示）');
    click(win, rows()[0].querySelector('[data-action="edit-version"]'));
    await flush(win);
    const avatarSlot = doc.querySelector('#editorChars .editor-char[data-char="0"] .media-avatar');
    ok(!!avatarSlot, '编辑弹窗内有角色头像上传槽位');
    click(win, avatarSlot);

    const fileInput = $('imageFileInput');
    const fakeAvatarFile = new win.File(['fake'], 'avatar.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [fakeAvatarFile], configurable: true });

    const uploadedAvatar = 'data:image/webp;base64,CCCC';
    const originalProcess = ZMD.imageUtil.processFile;
    ZMD.imageUtil.processFile = function (file, kind) {
        const dataUrl = kind === 'avatar' ? uploadedAvatar : 'data:image/webp;base64,DDDD';
        return win.Promise.resolve({
            dataUrl: dataUrl,
            width: kind === 'avatar' ? 456 : 256,
            height: kind === 'avatar' ? 564 : 256,
            bytes: 30000
        });
    };
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(50);
    ok(!!doc.querySelector('#editorChars .editor-char[data-char="0"] .media-avatar img'),
        '选择文件后弹窗内出现头像预览');
    ok(store.getState().versions[0].characters[0].avatar === '',
        '保存前图片不会写入主页数据');

    click(win, $('btnSaveEditor'));
    await flush(win);
    ZMD.imageUtil.processFile = originalProcess;
    ok(store.getState().versions[0].characters[0].avatar === uploadedAvatar,
        '保存后头像写入对应角色');
    ok(!!rows()[0].querySelector('.roster-thumb-avatar img'), '保存后主页第一行显示头像');

    // 武器图同样走弹窗上传
    click(win, rows()[0].querySelector('[data-action="edit-version"]'));
    await flush(win);
    click(win, doc.querySelector('#editorChars .editor-char[data-char="0"] .media-weapon'));
    Object.defineProperty(fileInput, 'files', { value: [fakeAvatarFile], configurable: true });
    ZMD.imageUtil.processFile = function (file, kind) {
        return win.Promise.resolve({
            dataUrl: 'data:image/webp;base64,DDDD',
            width: 256,
            height: 256,
            bytes: 20000
        });
    };
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(50);
    click(win, $('btnSaveEditor'));
    await flush(win);
    ZMD.imageUtil.processFile = originalProcess;
    ok(store.getState().versions[0].characters[0].weaponImage === 'data:image/webp;base64,DDDD',
        '武器图片保存到对应角色');
    ok(!!rows()[0].querySelector('.roster-thumb-weapon img'), '保存后主页第一行显示武器图');

    section('【8】数据序列化 / 删除');
    store.save();
    const raw = ZMD.storage.readJSON('arknights_endfield_collection_v1');
    ok(!!raw && raw.versions.length === 1, '数据写入收集统计专用缓存键');
    ok(!!raw && raw.versions[0].characters.length === 3, '三个角色被完整序列化');
    ok(!!raw && raw.versions[0].characters[0].avatar === uploadedAvatar, '头像 data URL 被保存');
    ok(!!raw && raw.versions[0].characters[0].weaponImage === 'data:image/webp;base64,DDDD',
        '武器图片 data URL 被保存');

    win.confirm = function () { return true; };

    click(win, rows()[0].querySelector('[data-action="delete-character"]'));
    await flush(win);
    ok(store.getState().versions[0].characters.length === 2, '删除角色后 store 剩 2 个角色');
    ok(rows().length === 2, '删除角色后主页剩下两行');
    ok(store.getState().versions[0].characters[0].name === '测试角色B', '删除的是正确角色（角色A）');

    click(win, doc.querySelector('.version-head [data-action="delete-version"]'));
    await flush(win);
    ok(store.getState().versions.length === 0, '删除版本后 store 为空');
    ok(!!$('collectionList').querySelector('.collection-empty'), '删除最后一个版本后回到空状态');

    section('【9】主题与页面入口');
    win.ZMD.theme.set('light');
    await flush(win);
    ok(doc.documentElement.getAttribute('data-theme') === 'light', '可切换到浅色主题');
    win.ZMD.theme.set('dark');
    await flush(win);
    ok(doc.documentElement.getAttribute('data-theme') === 'dark', '可切回深色主题');

    const indexHtml = fs.readFileSync(INDEX_PAGE, 'utf8');
    ok(indexHtml.indexOf('href="collection.html"') >= 0, '主页面头部有进入收集统计页的入口');
    ok(!!doc.querySelector('.header-tools a[href="index.html"]'), '收集统计页可返回抽卡规划页');

    ok(consoleErrors.length === 0, '页面运行期间没有未捕获错误', consoleErrors.join(' | '));
}
