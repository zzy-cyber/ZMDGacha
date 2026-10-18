/**
 * 远端内容读取：线上页面从 data/collection.json 读取站长发布的资料。
 *
 * 纯静态方案下这里只有读、没有写：
 * 内容由 tools/publish-collection.mjs 生成，随站点一起部署；
 * 访客打开页面时拉取同一份 JSON，因此看到的内容完全一致。
 *
 * 设计要点：
 *  - 失败一律返回 null，调用方静默降级到本地缓存，绝不阻塞渲染；
 *  - file:// 打开时不发请求（fetch 会被 CORS 拦），站长本地编辑正是这种场景；
 *  - 有超时保护，弱网下不会让首屏一直空着。
 */
(function (ZMD) {
    'use strict';

    /** 发布文档地址：相对路径，站点部署在子目录时同样可用 */
    var SOURCE = 'data/collection.json';

    /** 超时后放弃，用本地缓存渲染 */
    var TIMEOUT = 6000;

    function isValid(doc) {
        return !!doc && typeof doc === 'object' && Array.isArray(doc.versions);
    }

    /** 只有 http(s) 环境才请求；file:// 使用本地缓存 */
    function canFetch() {
        return typeof window.fetch === 'function' &&
            (location.protocol === 'http:' || location.protocol === 'https:');
    }

    /**
     * 拉取远端发布文档。
     * @returns {Promise<{schemaVersion?: number, publishedAt?: string, versions: Array}|null>}
     *          失败 / 超时 / 格式不对都返回 null
     */
    function fetchDoc() {
        if (!canFetch()) return Promise.resolve(null);

        var controller = typeof window.AbortController === 'function' ? new AbortController() : null;
        var timer = null;
        var options = { cache: 'no-cache' };

        if (controller) {
            options.signal = controller.signal;
            timer = setTimeout(function () {
                try {
                    controller.abort();
                } catch (e) { /* 忽略 */ }
            }, TIMEOUT);
        }

        return fetch(SOURCE, options)
            .then(function (response) {
                return response.ok ? response.json() : null;
            })
            .then(function (doc) {
                if (isValid(doc)) return doc;
                if (doc) console.warn('[ZMD.collectionRemote] 发布文档格式不对，已忽略');
                return null;
            })
            .catch(function (error) {
                // 首次部署时文件还不存在、断网、超时都会走到这里，属于预期情况
                console.warn('[ZMD.collectionRemote] 未能读取发布内容，使用本地缓存:',
                    error && (error.name || error.message));
                return null;
            })
            .then(function (doc) {
                if (timer) clearTimeout(timer);
                return doc;
            });
    }

    ZMD.collectionRemote = {
        SOURCE: SOURCE,
        canFetch: canFetch,
        fetchDoc: fetchDoc
    };
})(window.ZMD);
