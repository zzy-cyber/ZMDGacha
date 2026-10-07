/**
 * 生成预览页（仅供无头浏览器截图核对排版，不参与交付功能）：
 *   preview-plan.html       打开「抽卡规划」弹窗
 *   preview-collapsed.html  资源统计模块收起
 *   preview-arsenal.html    开启「武库配额获取」并勾选抽取武器，展示武库抽数列
 * 运行：node .verify/make-preview.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function build(extraScript) {
    return html
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

console.log('已生成 .verify/preview-plan.html、preview-collapsed.html 与 preview-arsenal.html');
