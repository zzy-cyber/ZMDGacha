/**
 * 生成预览页（仅供无头浏览器截图核对排版，不参与交付功能）：
 *   preview-plan.html        打开「抽卡规划」弹窗
 *   preview-collapsed.html   资源统计模块收起
 *   preview-arsenal.html     开启「武库配额获取」并勾选抽取武器，展示武库抽数列
 *   preview-collection.html  收集统计页（深色，带示例数据）
 *   preview-collection-light.html 收集统计页（浅色，带示例数据）
 * 运行：node .verify/make-preview.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const collectionHtml = fs.readFileSync(path.join(root, 'collection.html'), 'utf8');

function build(extraScript) {
    return html
        .replace(/href="css\//g, 'href="../css/')
        .replace(/src="js\//g, 'src="../js/')
        .replace('</body>', '<script>window.addEventListener("load", function () { ' + extraScript + ' });</script>\n</body>');
}

function buildCollection(extraScript) {
    return collectionHtml
        .replace(/href="css\//g, 'href="../css/')
        .replace(/src="js\//g, 'src="../js/')
        .replace('</body>', '<script>window.addEventListener("load", function () { ' + extraScript + ' });</script>\n</body>');
}


fs.writeFileSync(path.join(__dirname, 'preview-plan.html'),
    build('ZMD.ui.planModal.open();'), 'utf8');

fs.writeFileSync(path.join(__dirname, 'preview-collapsed.html'),
    build('ZMD.ui.resources.toggleCollapsed();'), 'utf8');

// 武库配额预览：手填 3960 配额（2 抽）+ 开启功能开关，
// 并给两个角色分别勾选「抽取武器」，用于核对每角色开关与武库抽数列的排版
fs.writeFileSync(path.join(__dirname, 'preview-arsenal.html'),
    build([
        'ZMD.store.setResource("arsenalQuota", 3960);',
        'ZMD.store.setSettings({ arsenalPlanEnabled: true });',
        'ZMD.renderer.cancelPending();',
        'ZMD.renderer.renderAll(true);',
        'setTimeout(function () {',
        '    ["role1Weapon", "role2Weapon"].forEach(function (field) {',
        '        var box = document.querySelector("#resultTableBody [data-field=\\"" + field + "\\"]");',
        '        if (box && !box.checked) {',
        '            box.checked = true;',
        '            box.dispatchEvent(new Event("change", { bubbles: true }));',
        '        }',
        '    });',
        '}, 50);'
    ].join(' ')), 'utf8');

console.log('已生成 .verify/preview-plan.html、preview-collapsed.html、preview-arsenal.html');

// ===== 收集统计页预览 =====
// 直接在页面里写入示例数据（会先 reset，保证每次截图一致）。
// 图片使用同目录下的 demo-avatar-*.webp / demo-weapon-*.webp（仅用于截图）。
const seedCollection = [
    'var store = ZMD.collectionStore;',
    'store.reset();',
    'function addChar(v, name, owned, weaponOwned, aidx, widx) {',
    '    var ci = store.addCharacter(v);',
    '    store.setCharacterField(v, ci, "name", name);',
    '    store.setCharacterField(v, ci, "owned", owned);',
    '    store.setCharacterField(v, ci, "weaponOwned", weaponOwned);',
    '    if (aidx) store.setCharacterField(v, ci, "avatar", "demo-avatar-" + aidx + ".webp");',
    '    if (widx) {',
    '        store.setCharacterField(v, ci, "weaponImage", "demo-weapon-" + widx + ".webp");',
    '        store.setCharacterField(v, ci, "weaponName", "专属武器 " + widx);',
    '    }',
    '}',
    'var v1 = store.addVersion();',
    'store.setVersionName(v1, "2.1「星尘」");',
    'addChar(v1, "星辉", true, true, 1, 1);',
    'addChar(v1, "澜汐", true, false, 2, 2);',
    'addChar(v1, "砾", false, true, 3, 3);',
    'addChar(v1, "澄空", true, true, 4, 4);',
    'var v2 = store.addVersion();',
    'store.setVersionName(v2, "2.0「回响」");',
    'addChar(v2, "白露", true, true, 5, 5);',
    'addChar(v2, "未央", false, false, 6, 6);',
    'ZMD.ui.collection.render();'
].join(' ');

fs.writeFileSync(path.join(__dirname, 'preview-collection.html'),
    buildCollection('ZMD.theme.apply("dark", false); ' + seedCollection), 'utf8');

fs.writeFileSync(path.join(__dirname, 'preview-collection-light.html'),
    buildCollection('ZMD.theme.apply("light", false); ' + seedCollection), 'utf8');

// 添加 / 编辑版本弹窗（只用于核对弹窗排版）
fs.writeFileSync(path.join(__dirname, 'preview-collection-editor.html'),
    buildCollection('ZMD.theme.apply("dark", false); ' + seedCollection +
        ' ZMD.ui.collection.openEditor({ versionIndex: 0 });'), 'utf8');

console.log('已生成 .verify/preview-collection.html、preview-collection-light.html、preview-collection-editor.html');
