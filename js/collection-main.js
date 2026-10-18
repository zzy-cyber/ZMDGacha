/**
 * 收集统计页的启动入口。
 *
 * 启动顺序：主题 → 读取本地缓存 → 界面模块挂载（首次渲染）→ 定时保存。
 * 与主页面完全独立，只共享 storage / theme / toast 等基础能力。
 * 缓存位于 IndexedDB，读取是异步的，因此界面在数据就绪后再挂载。
 */
(function (ZMD) {
    'use strict';

    var store = ZMD.collectionStore;

    /** 自动保存间隔（输入名称时不必每次按键都写缓存）。 */
    var AUTO_SAVE_INTERVAL = 5000;

    /** 配额不足只提示一次，避免每 5 秒刷屏 */
    var quotaWarned = false;

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

    function initModules() {
        if (ZMD.ui && ZMD.ui.collection && typeof ZMD.ui.collection.init === 'function') {
            ZMD.ui.collection.init();
        }
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

    function logReady() {
        console.log('💠 明日方舟：终末地 - 角色 & 武器收集统计 已就绪');
        console.log('   - 角色头像 456×564 / 武器图片 256×256，上传后自动裁切压缩为 WebP');
        console.log('   - 角色拥有率 = 已拥有角色 / 全部角色；专武持有率 = 已拥有角色的专武数 / 已拥有角色数');
        console.log('   - 数据保存在 IndexedDB（arknights_endfield_collection_v1），不上传服务器');
    }

    function start() {
        initTheme();
        initData().catch(function (error) {
            console.error('[ZMD] 读取本地缓存失败，将以空数据启动:', error);
        }).then(function () {
            initModules();
            initPersistence();
            logReady();
            warnIfNotPersistent();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})(window.ZMD);
