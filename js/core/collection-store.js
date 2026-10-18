/**
 * 角色 & 武器收集统计的状态中心（与抽卡规划相互独立）。
 *
 * 数据流与主页面一致：界面只调用这里的方法 → 这里标记变更并 notify →
 * 界面订阅后决定是否重绘。名称输入这种「不改变结构」的修改只标记为 field，
 * 界面不会重建 DOM，因此不会打断输入光标。
 *
 * 存储：IndexedDB（键 arknights_endfield_collection_v1），
 * 图片以压缩后的 data URL 形式随角色对象一起保存。
 * 读写均为异步，save / load / reset 返回 Promise。
 */
(function (ZMD) {
    'use strict';

    var storage = ZMD.storage;
    var KEY = storage.KEYS.COLLECTION;

    /** 允许的筛选值（与 collection-calc 保持一致） */
    var FILTERS = ['all', 'owned', 'unowned'];

    /** 角色允许被写入的字段 */
    var CHARACTER_FIELDS = ['name', 'owned', 'avatar', 'weaponName', 'weaponImage', 'weaponOwned'];

    /** 这些字段会改变拥有状态或图片，必须重绘列表 */
    var VISUAL_FIELDS = ['owned', 'avatar', 'weaponImage', 'weaponOwned'];

    function createCharacter() {
        return {
            name: '',
            owned: false,
            /** 角色头像：压缩后的 456×564 图片 data URL */
            avatar: '',
            weaponName: '',
            /** 专武图片：压缩后的 256×256 图片 data URL */
            weaponImage: '',
            weaponOwned: false
        };
    }

    function createVersion(name) {
        return {
            name: name || '',
            characters: []
        };
    }

    var state = {
        versions: [],
        /** 界面筛选偏好，会持久化 */
        filter: 'all'
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

    /** 只保留已知字段，避免旧缓存里的脏字段污染状态 */
    function normalizeCharacter(raw) {
        var source = raw || {};
        var character = createCharacter();
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

    function normalizeVersion(raw) {
        var source = raw || {};
        var characters = Array.isArray(source.characters) ? source.characters : [];
        return {
            name: source.name == null ? '' : String(source.name),
            characters: characters.map(normalizeCharacter)
        };
    }

    // ======================== 版本 ========================

    /**
     * 追加一个版本。
     * @param {object} [data] 可选：{ name, characters }，用于「添加版本」弹窗保存
     * @returns {number} 新版本下标
     */
    function addVersion(data) {
        var version = createVersion(data && data.name);
        if (data && Array.isArray(data.characters)) {
            version.characters = data.characters.map(normalizeCharacter);
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
        version.characters = characters.map(normalizeCharacter);
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
     * 写入 IndexedDB。
     * @returns {Promise<boolean>} 是否成功（配额不足时会返回 false）
     */
    function save() {
        return storage.writeJSON(KEY, {
            versions: state.versions,
            filter: state.filter
        });
    }

    /**
     * 读取缓存，并对旧数据做字段补齐。
     * @returns {Promise<boolean>} 是否读到有效数据
     */
    function load() {
        return storage.readJSON(KEY).then(function (data) {
            if (!data || typeof data !== 'object') return false;

            state.versions = (Array.isArray(data.versions) ? data.versions : []).map(normalizeVersion);
            state.filter = FILTERS.indexOf(data.filter) >= 0 ? data.filter : 'all';
            return true;
        });
    }

    /** 整体替换版本列表（保存失败时回滚草稿修改使用）。 */
    function restoreVersions(list) {
        state.versions = (Array.isArray(list) ? list : []).map(normalizeVersion);
        notify('structure');
    }

    /** 清空收集数据（清空缓存时使用）。 */
    function reset() {
        var pending = storage.remove(KEY);
        state.versions = [];
        state.filter = 'all';
        notify('reset');
        return pending;
    }

    ZMD.collectionStore = {
        FILTERS: FILTERS,
        CHARACTER_FIELDS: CHARACTER_FIELDS,
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
        restoreVersions: restoreVersions,
        reset: reset
    };
})(window.ZMD);
