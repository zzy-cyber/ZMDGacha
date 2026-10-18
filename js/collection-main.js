/**
 * 收集统计页的启动入口。
 *
 * 两种模式，启动流程不同：
 *  - 编辑模式（本地 file:// 打开，或线上加 ?edit=1）：
 *      读取本地缓存 → 挂载界面 → 定时保存。
 *      内容以本地工作副本为准，不请求远端，避免覆盖还没导出的修改。
 *  - 只读模式（线上普通访客）：
 *      先用本地缓存秒开 → 再拉取 data/collection.json
 *      → 内容以远端为准、拥有状态按角色 id 保留 → 重绘。
 *
 * 与主页面完全独立，只共享 storage / theme / toast 等基础能力。
 */
(function (ZMD) {
    'use strict';

    var store = ZMD.collectionStore;

    /** 自动保存间隔（输入名称时不必每次按键都写缓存）。 */
    var AUTO_SAVE_INTERVAL = 5000;

    /** 配额不足只提示一次，避免每 5 秒刷屏 */
    var quotaWarned = false;

    /**
     * 是否处于编辑模式：
     *  - file:// 双击打开 = 站长本地编辑（与以前完全一样）；
     *  - 线上加 ?edit=1 = 站长在线上编辑（备用入口）；
     *  - 其余 = 访客只读。
     * 只读只是交互层限制：纯静态站点没有写接口，访客改不到别人的数据。
     */
    function isEditMode() {
        if (location.protocol === 'file:') return true;
        try {
            return new URLSearchParams(location.search).get('edit') === '1';
        } catch (e) {
            return false;
        }
    }

    function safeSave() {
        return store.save().then(function (ok) {
            // 缓存不可用时 store 会退回内存，刷新才丢失；只有真正可写却写失败才是空间不足
            if (!ok && !quotaWarned && ZMD.storage && ZMD.storage.available) {
                quotaWarned = true;
                if (ZMD.toast) ZMD.toast.show('❌ 本地缓存写入失败，可能空间不足');
            }
            return ok;
        });
    }

    function initTheme() {
        if (ZMD.theme && ZMD.theme.init) ZMD.theme.init();
    }

    function initData() {
        return store.load();
    }

    function initModules(canEdit) {
        if (ZMD.ui && ZMD.ui.collection && typeof ZMD.ui.collection.init === 'function') {
            ZMD.ui.collection.init({ canEdit: canEdit });
        }
        // 导出 / 导入按钮只在编辑模式挂载（只读模式下按钮本身也不显示）
        if (canEdit && ZMD.ui && ZMD.ui.collectionPublish) {
            ZMD.ui.collectionPublish.init();
        }
    }

    /** 拉取远端发布内容；模块缺失或环境不支持时返回 null。 */
    function fetchRemote() {
        if (!ZMD.collectionRemote || typeof ZMD.collectionRemote.fetchDoc !== 'function') {
            return Promise.resolve(null);
        }
        return ZMD.collectionRemote.fetchDoc();
    }

    function initPersistence() {
        setInterval(safeSave, AUTO_SAVE_INTERVAL);

        window.addEventListener('beforeunload', function () {
            store.save();
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') store.save();
        });
    }

    /**
     * 缓存不可用（常见于 Chrome / Edge 以 file:// 打开）时提示一次：
     * 此时数据只在内存中，刷新后会丢失。
     */
    function warnIfNotPersistent() {
        if (!ZMD.storage || ZMD.storage.available) return;
        if (ZMD.toast) ZMD.toast.show('⚠️ 当前环境无法持久化，数据仅在本次会话有效');
    }

    function logReady(canEdit) {
        console.log('💠 明日方舟：终末地 - 角色 & 武器收集统计 已就绪');
        console.log('   - 模式：' + (canEdit
            ? '编辑（内容以本地工作副本为准，改完导出后运行 npm run publish）'
            : '只读（内容来自站长发布的 data/collection.json）'));
        console.log('   - 角色头像 456×564 / 武器图片 256×256，上传后自动裁切压缩为 WebP');
        console.log('   - 角色拥有率 = 已拥有角色 / 全部角色；专武持有率 = 已拥有角色的专武数 / 已拥有角色数');
        console.log('   - 拥有状态只保存在本机 IndexedDB，不上传服务器');
    }

    function start() {
        var canEdit = isEditMode();
        initTheme();

        initData().catch(function (error) {
            console.error('[ZMD] 读取本地缓存失败，将以空数据启动:', error);
        }).then(function () {
            var hasLocal = store.getState().versions.length > 0;

            // 只读模式且本地没有任何缓存：先等远端内容，避免先闪一下空列表
            if (!canEdit && !hasLocal) {
                return fetchRemote().then(function (doc) {
                    if (doc) return store.applyRemote(doc);
                }).then(function () {
                    initModules(canEdit);
                    initPersistence();
                    logReady(canEdit);
                    warnIfNotPersistent();
                });
            }

            initModules(canEdit);
            initPersistence();
            logReady(canEdit);
            warnIfNotPersistent();

            // 编辑模式：内容以本地工作副本为准，不请求远端
            if (canEdit) return null;

            // 只读模式：缓存已渲染，再静默对齐远端发布内容
            return fetchRemote().then(function (doc) {
                if (!doc) return;
                // 还没有正式发布过（初始的空文件）时保留本地缓存，避免把访客已有的内容清掉
                if (!doc.publishedAt) return;
                // publishedAt 没变说明站长没有重新发布，不必重绘
                if (doc.publishedAt === store.getState().publishedAt) return;
                return store.applyRemote(doc);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})(window.ZMD);
