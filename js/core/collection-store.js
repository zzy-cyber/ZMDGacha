/**
 * 角色 & 武器收集统计的状态中心（与抽卡规划相互独立）。
 *
 * 数据流与主页面一致：界面只调用这里的方法 → 这里标记变更并 notify →
 * 界面订阅后决定是否重绘。名称输入这种「不改变结构」的修改只标记为 field，
 * 界面不会重建 DOM，因此不会打断输入光标。
 *
 * 存储：IndexedDB（键 arknights_endfield_collection_v1）。
 * 数据分两类，职责不同：
 *  - 内容（版本名、角色名、专武名、图片）：站长统一维护，发布后由所有访客共享；
 *  - 拥有状态（owned / weaponOwned）：属于每个访客自己，只存在本机。
 * 两者靠角色的稳定 id 对应：远端内容整体替换时，按 id 把本地勾选搬回去。
 * 读写均为异步，save / load / reset 返回 Promise。
 */
(function (ZMD) {
    'use strict';

    var storage = ZMD.storage;
    var KEY = storage.KEYS.COLLECTION;

    /** 允许的筛选值（与 collection-calc 保持一致） */
    var FILTERS = ['all', 'owned', 'unowned'];

    /** 角色允许被写入的字段（id 由系统维护，不接受 UI 写入） */
    var CHARACTER_FIELDS = ['name', 'owned', 'avatar', 'weaponName', 'weaponImage', 'weaponOwned'];

    /** 这些字段会改变拥有状态或图片，必须重绘列表 */
    var VISUAL_FIELDS = ['owned', 'avatar', 'weaponImage', 'weaponOwned'];

    /** 发布文档版本号（写入 data/collection.json） */
    var SCHEMA_VERSION = 2;

    /**
     * 生成一个稳定 id。
     * 角色与版本一旦创建就必须带着 id 走完全程：
     * 发布到线上后，访客的「拥有状态」是按 id 记录的，
     * id 一旦变化，用户的勾选就会指向不存在的角色。
     */
    function newId(prefix) {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return prefix + '_' + window.crypto.randomUUID().slice(0, 8);
            }
        } catch (e) { /* 忽略：走下面的兜底 */ }
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    /** FNV-1a：跨机器结果一致的字符串哈希，用于给旧数据补 id */
    function fnv1a(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = (hash * 16777619) >>> 0;
        }
        return hash.toString(36);
    }

    /**
     * 旧缓存里的角色没有 id，用「版本名 + 角色名」算一个确定性 id。
     * 站长和访客各自迁移后会得到同一个 id，因此已有的勾选不会丢。
     * 代价是旧数据改名会换 id（只影响旧数据一次）。
     */
    function legacyCharacterId(versionName, characterName) {
        return 'c_' + fnv1a(String(versionName || '') + '|' + String(characterName || ''));
    }

    function createCharacter() {
        return {
            /** 稳定标识：发布内容与本地拥有状态靠它对应 */
            id: newId('c'),
            name: '',
            owned: false,
            /** 角色头像：压缩后的 456×564 图片 data URL，发布后变成相对路径 */
            avatar: '',
            weaponName: '',
            /** 专武图片：压缩后的 256×256 图片 data URL，发布后变成相对路径 */
            weaponImage: '',
            weaponOwned: false
        };
    }

    function createVersion(name) {
        return {
            id: newId('v'),
            name: name || '',
            characters: []
        };
    }

    var state = {
        versions: [],
        /** 界面筛选偏好，会持久化 */
        filter: 'all',
        /** 当前内容来自哪一次发布（远端 JSON 的 publishedAt），用于判断是否需要重绘 */
        publishedAt: ''
    };

    var listeners = [];

    function notify(reason) {
        listeners.slice().forEach(function (listener) {
            try {
                listener(state, reason);
            } catch (e) {
                console.error('[ZMD.collectionStore] 订阅者执行出错:', e);
            }
        });
    }

    /**
     * 订阅状态变化。
     * @param {(state: object, reason: string) => void} listener
     * @returns {function(): void}
     */
    function subscribe(listener) {
        listeners.push(listener);
        return function () {
            var i = listeners.indexOf(listener);
            if (i >= 0) listeners.splice(i, 1);
        };
    }

    function getState() {
        return state;
    }

    function getVersion(index) {
        return state.versions[index] || null;
    }

    function getCharacter(versionIndex, characterIndex) {
        var version = state.versions[versionIndex];
        if (!version) return null;
        return version.characters[characterIndex] || null;
    }

    /**
     * 只保留已知字段，避免旧缓存里的脏字段污染状态。
     * 旧数据没有 id：用「版本名 + 角色名」补一个确定性 id，
     * 与站长发布出去的内容保持同一套标识。
     */
    function normalizeCharacter(raw, versionName) {
        var source = raw || {};
        var character = createCharacter();
        character.id = source.id ? String(source.id) : legacyCharacterId(versionName, source.name);
        CHARACTER_FIELDS.forEach(function (field) {
            if (source[field] === undefined) return;
            if (field === 'owned' || field === 'weaponOwned') {
                character[field] = !!source[field];
            } else {
                character[field] = String(source[field] == null ? '' : source[field]);
            }
        });
        return character;
    }

    function normalizeVersion(raw, index) {
        var source = raw || {};
        var name = source.name == null ? '' : String(source.name);
        var characters = Array.isArray(source.characters) ? source.characters : [];
        return {
            /** 版本 id 只用于发布文档的完整性校验，不参与拥有状态匹配 */
            id: source.id ? String(source.id) : 'v_' + fnv1a(name + '#' + (index || 0)),
            name: name,
            characters: characters.map(function (character) {
                return normalizeCharacter(character, name);
            })
        };
    }

    /** 把整份版本列表规范化（统一入口，避免各处漏传 versionName） */
    function normalizeVersions(list) {
        return (Array.isArray(list) ? list : []).map(function (version, index) {
            return normalizeVersion(version, index);
        });
    }

    // ======================== 版本 ========================

    /**
     * 追加一个版本。
     * @param {object} [data] 可选：{ name, characters }，用于「添加版本」弹窗保存
     * @returns {number} 新版本下标
     */
    function addVersion(data) {
        var name = data && data.name != null ? String(data.name) : '';
        var version = createVersion(name);
        if (data && Array.isArray(data.characters)) {
            // 注意：不能直接 map(normalizeCharacter)，map 会把下标当成第二个参数传进去
            version.characters = data.characters.map(function (character) {
                return normalizeCharacter(character, name);
            });
        }
        state.versions.push(version);
        notify('structure');
        return state.versions.length - 1;
    }

    function removeVersion(index) {
        if (index < 0 || index >= state.versions.length) return false;
        state.versions.splice(index, 1);
        notify('structure');
        return true;
    }

    /**
     * 整体替换一个版本的信息（名称 + 角色列表），由「编辑版本」弹窗调用。
     * 角色对象里的 owned / weaponOwned 会原样保留。
     */
    function updateVersion(index, data) {
        var version = state.versions[index];
        if (!version) return false;

        version.name = data && data.name != null ? String(data.name) : '';
        var characters = data && Array.isArray(data.characters) ? data.characters : [];
        // 草稿里的角色已经带着 id（cloneCharacter 保留），这里只做字段清洗
        version.characters = characters.map(function (character) {
            return normalizeCharacter(character, version.name);
        });
        notify('structure');
        return true;
    }

    function setVersionName(index, name) {
        var version = state.versions[index];
        if (!version) return false;
        var value = name == null ? '' : String(name);
        if (version.name === value) return false;
        version.name = value;
        notify('field');
        return true;
    }

    // ======================== 角色 ========================

    /** 在指定版本里追加一个空角色，返回新角色下标。 */
    function addCharacter(versionIndex) {
        var version = state.versions[versionIndex];
        if (!version) return -1;
        version.characters.push(createCharacter());
        notify('structure');
        return version.characters.length - 1;
    }

    function removeCharacter(versionIndex, characterIndex) {
        var version = state.versions[versionIndex];
        if (!version) return false;
        if (characterIndex < 0 || characterIndex >= version.characters.length) return false;
        version.characters.splice(characterIndex, 1);
        notify('structure');
        return true;
    }

    /**
     * 修改角色的一个字段。
     * @param {number} versionIndex
     * @param {number} characterIndex
     * @param {string} field CHARACTER_FIELDS 之一
     * @param {*} value
     */
    function setCharacterField(versionIndex, characterIndex, field, value) {
        if (CHARACTER_FIELDS.indexOf(field) < 0) {
            console.warn('[ZMD.collectionStore] 未知角色字段:', field);
            return false;
        }
        var character = getCharacter(versionIndex, characterIndex);
        if (!character) return false;

        var next;
        if (field === 'owned' || field === 'weaponOwned') {
            next = !!value;
        } else {
            next = value == null ? '' : String(value);
        }
        if (character[field] === next) return false;
        character[field] = next;

        notify(VISUAL_FIELDS.indexOf(field) >= 0 ? 'structure' : 'field');
        return true;
    }

    // ======================== 筛选 ========================

    function setFilter(filter) {
        if (FILTERS.indexOf(filter) < 0) filter = 'all';
        if (state.filter === filter) return false;
        state.filter = filter;
        notify('filter');
        return true;
    }

    // ======================== 持久化 ========================

    /**
     * 收集所有角色的拥有状态，key 为角色 id。
     * 这是「个人数据」，只存在本机，发布时会被剥离。
     */
    function collectOwnedMap() {
        var map = {};
        state.versions.forEach(function (version) {
            version.characters.forEach(function (character) {
                map[character.id] = {
                    owned: !!character.owned,
                    weaponOwned: !!character.weaponOwned
                };
            });
        });
        return map;
    }

    /**
     * 把拥有状态按 id 回填到角色上。
     * 远端内容里没有 owned，必须靠这一步保住用户已有的勾选。
     */
    function applyOwnedMap(map) {
        if (!map || typeof map !== 'object') return;
        state.versions.forEach(function (version) {
            version.characters.forEach(function (character) {
                var entry = map[character.id];
                if (!entry) return;
                character.owned = !!entry.owned;
                character.weaponOwned = !!entry.weaponOwned;
            });
        });
    }

    /**
     * 写入 IndexedDB。
     * 落盘时把「内容」与「个人拥有状态」拆成两份：
     * 内容随版本列表存，拥有状态按角色 id 单独存，
     * 这样远端内容整体替换时，用户的勾选仍然能按 id 找回来。
     * @returns {Promise<boolean>} 是否成功（配额不足时会返回 false）
     */
    function save() {
        return storage.writeJSON(KEY, {
            versions: state.versions,
            filter: state.filter,
            publishedAt: state.publishedAt,
            owned: collectOwnedMap()
        });
    }

    /**
     * 读取缓存，并对旧数据做字段补齐。
     * @returns {Promise<boolean>} 是否读到有效数据
     */
    function load() {
        return storage.readJSON(KEY).then(function (data) {
            if (!data || typeof data !== 'object') return false;

            state.versions = normalizeVersions(data.versions);
            state.filter = FILTERS.indexOf(data.filter) >= 0 ? data.filter : 'all';
            state.publishedAt = data.publishedAt == null ? '' : String(data.publishedAt);

            // 新格式：拥有状态以 owned 映射为准。
            // 旧格式没有这个字段，角色自带的 owned 已在 normalizeCharacter 里保留。
            if (data.owned && typeof data.owned === 'object') applyOwnedMap(data.owned);
            return true;
        });
    }

    /**
     * 用远端发布的内容替换本地清单（线上只读模式使用）。
     * 内容整体以远端为准，个人勾选按角色 id 保留；
     * 被站长删掉的角色，其旧状态自然失效。
     * @param {{versions: Array, publishedAt?: string}} doc
     * @returns {Promise<boolean>}
     */
    function applyRemote(doc) {
        if (!doc || !Array.isArray(doc.versions)) return Promise.resolve(false);

        var ownedMap = collectOwnedMap();
        state.versions = normalizeVersions(doc.versions);
        state.publishedAt = doc.publishedAt == null ? '' : String(doc.publishedAt);
        applyOwnedMap(ownedMap);

        notify('structure');
        return save();
    }

    /**
     * 生成发布文档：只含公共内容，不含任何个人拥有状态。
     * 图片此时仍是 data URL，由 tools/publish-collection.mjs
     * 解码成文件，并把字段改写成相对路径。
     */
    function toPublishDoc() {
        return {
            schemaVersion: SCHEMA_VERSION,
            publishedAt: new Date().toISOString(),
            versions: state.versions.map(function (version) {
                return {
                    id: version.id,
                    name: version.name,
                    characters: version.characters.map(function (character) {
                        return {
                            id: character.id,
                            name: character.name,
                            avatar: character.avatar,
                            weaponName: character.weaponName,
                            weaponImage: character.weaponImage
                        };
                    })
                };
            })
        };
    }

    /** 整体替换版本列表（保存失败时回滚草稿修改使用）。 */
    function restoreVersions(list) {
        state.versions = normalizeVersions(list);
        notify('structure');
    }

    /** 清空收集数据（清空缓存时使用）。 */
    function reset() {
        var pending = storage.remove(KEY);
        state.versions = [];
        state.filter = 'all';
        state.publishedAt = '';
        notify('reset');
        return pending;
    }

    ZMD.collectionStore = {
        FILTERS: FILTERS,
        CHARACTER_FIELDS: CHARACTER_FIELDS,
        SCHEMA_VERSION: SCHEMA_VERSION,
        /** 供界面创建草稿角色使用，保证 id 只在一处生成 */
        createCharacter: createCharacter,
        newId: newId,
        subscribe: subscribe,
        getState: getState,
        getVersion: getVersion,
        getCharacter: getCharacter,
        addVersion: addVersion,
        removeVersion: removeVersion,
        updateVersion: updateVersion,
        setVersionName: setVersionName,
        addCharacter: addCharacter,
        removeCharacter: removeCharacter,
        setCharacterField: setCharacterField,
        setFilter: setFilter,
        save: save,
        load: load,
        applyRemote: applyRemote,
        toPublishDoc: toPublishDoc,
        collectOwnedMap: collectOwnedMap,
        restoreVersions: restoreVersions,
        reset: reset
    };
})(window.ZMD);
