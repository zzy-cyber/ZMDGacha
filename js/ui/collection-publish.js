/**
 * 发布包导出 / 导入（仅编辑模式可用）。
 *
 * 纯静态方案没有写接口，发布链路是：
 *   页面编辑 → 导出 collection-draft.json → tools/publish-collection.mjs
 *   → data/collection.json + assets/collection/*.webp → git push
 *
 * 导出的文件里图片仍是 data URL（浏览器压缩后的结果），
 * 由 Node 脚本解码成独立文件，避免整份 JSON 变成几 MB 的 base64。
 * 导入则是反向操作，用于「清了缓存 / 换了电脑」时恢复工作副本。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.collectionStore;

    var el = {};

    /** 导出文件名固定：发布脚本按这个名字在「下载」目录里找最新一份 */
    var EXPORT_NAME = 'collection-draft.json';

    function cacheElements() {
        el.exportBtn = util.$('btnExportCollection');
        el.importBtn = util.$('btnImportCollection');
        el.importInput = util.$('collectionImportInput');
        el.publishHint = util.$('collectionPublishHint');
    }

    function countCharacters(versions) {
        return (versions || []).reduce(function (sum, version) {
            return sum + (Array.isArray(version.characters) ? version.characters.length : 0);
        }, 0);
    }

    /** 导出发布草稿（不含拥有状态）。 */
    function exportDraft() {
        var doc = store.toPublishDoc();
        var versions = doc.versions || [];

        if (versions.length === 0) {
            ZMD.toast.show('还没有内容可以导出');
            return;
        }

        var text = JSON.stringify(doc, null, 2);
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');

        link.href = url;
        link.download = EXPORT_NAME;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

        var size = text.length / 1024 / 1024;
        ZMD.toast.show('✅ 已导出 ' + versions.length + ' 个版本 / ' +
            countCharacters(versions) + ' 个角色（' + size.toFixed(1) + ' MB）');
    }

    /** 导入 JSON：发布文档或之前导出的草稿都支持。 */
    function importFile(file) {
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function () {
            var doc = null;
            try {
                doc = JSON.parse(String(reader.result || ''));
            } catch (e) {
                ZMD.toast.show('❌ 不是有效的 JSON 文件');
                return;
            }

            if (!doc || !Array.isArray(doc.versions)) {
                ZMD.toast.show('❌ 文件格式不对：缺少 versions 列表');
                return;
            }

            var count = countCharacters(doc.versions);
            var message = '导入会替换当前的版本与角色资料。\n\n' +
                '共 ' + doc.versions.length + ' 个版本 / ' + count + ' 个角色。\n' +
                '拥有状态会按角色 id 保留（文件里没有的角色不受影响）。\n\n确定继续？';
            if (!window.confirm(message)) return;

            store.applyRemote(doc).then(function (ok) {
                ZMD.toast.show(ok
                    ? '✅ 已导入，可以继续编辑'
                    : '⚠️ 已导入，但本地缓存写入失败');
            });
        };
        reader.onerror = function () {
            ZMD.toast.show('❌ 读取文件失败');
        };
        reader.readAsText(file);
    }

    /** 只在编辑模式下调用：先把按钮显示出来，再绑定事件。 */
    function init() {
        cacheElements();

        [el.exportBtn, el.importBtn, el.publishHint].forEach(function (node) {
            if (node) node.hidden = false;
        });

        util.on(el.exportBtn, 'click', exportDraft);
        util.on(el.importBtn, 'click', function () {
            if (el.importInput) el.importInput.click();
        });
        util.on(el.importInput, 'change', function () {
            var file = el.importInput.files && el.importInput.files[0];
            importFile(file);
            el.importInput.value = '';
        });
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.collectionPublish = {
        init: init,
        exportDraft: exportDraft,
        importFile: importFile
    };
})(window.ZMD);
