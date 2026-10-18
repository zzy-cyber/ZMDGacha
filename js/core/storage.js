/**
 * 本地缓存封装（IndexedDB）。
 *
 * 设计要点：
 *  - 收集统计里保存的是压缩后的 data URL 图片，localStorage 的约 5MB 上限很容易写满，
 *    因此统一改为 IndexedDB（配额按磁盘比例分配，通常有几百 MB）；
 *  - IndexedDB 是异步 API：所有读写都返回 Promise，且**永不 reject** ——
 *    读到数据返回数据、没有数据返回 null，写入成功返回 true、失败返回 false，
 *    调用方无需再包 try/catch；
 *  - 不可用时（部分浏览器的 file:// 页面、隐私模式、配额耗尽）自动退回内存保存，
 *    当前会话功能不受影响，刷新后丢失；
 *  - 首次升级时把旧版 localStorage 里的数据迁移过来，迁移成功后删除旧键，
 *    用户升级不会丢数据。
 */
(function (ZMD) {
    'use strict';

    var KEYS = {
        /** 资源数据 + 版本规划 */
        PLANNER: 'arknights_endfield_planner_v2',
        /** 默认抽数设置 */
        SETTINGS: 'arknights_endfield_settings_v1',
        /** 主题偏好 */
        THEME: 'arknights_endfield_theme_v1',
        /** 角色 & 武器收集统计（版本、角色、图片、拥有状态） */
        COLLECTION: 'arknights_endfield_collection_v1'
    };

    /** IndexedDB 数据库名 / 版本 / 对象仓库名 */
    var DB_NAME = 'arknights_endfield';
    var DB_VERSION = 1;
    var STORE_NAME = 'cache';
    /** 迁移标记：存在即表示旧 localStorage 数据已经搬完，避免重复迁移 */
    var MIGRATION_KEY = '__migrated_from_localstorage__';

    /** 浏览器是否提供 IndexedDB（有些环境只是没有这个属性） */
    var supported = (function () {
        try {
            return !!window.indexedDB;
        } catch (e) {
            return false;
        }
    })();

    /** 打开数据库失败后置为 true：此后不再重试，直接用内存兜底 */
    var broken = false;

    /** 已打开的数据库连接（成功打开后同步持有，保证卸载前也能立即发起写入） */
    var database = null;
    /** 打开数据库 + 迁移旧数据的 Promise，只执行一次 */
    var opening = null;

    /** 内存兜底：IndexedDB 不可用时保证当前会话功能正常 */
    var memory = {};

    /** 同一个键的失败只提示一次，避免定时保存时刷屏 */
    var warned = {};

    // ======================== IndexedDB 基础操作 ========================

    function openDatabase() {
        return new Promise(function (resolve, reject) {
            var request;
            try {
                request = window.indexedDB.open(DB_NAME, DB_VERSION);
            } catch (error) {
                reject(error);
                return;
            }

            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onerror = function () {
                reject(request.error || new Error('IndexedDB 打开失败'));
            };
            request.onblocked = function () {
                console.warn('[ZMD.storage] IndexedDB 被其他标签页占用，等待其关闭…');
            };
        });
    }

    /**
     * 在一个事务里执行操作。
     * 注意：Promise 的 executor 是同步执行的，因此事务会在调用时立刻创建，
     * 页面卸载（beforeunload）时发起的写入也能被浏览器排上队。
     *
     * @param {IDBDatabase} db
     * @param {IDBTransactionMode} mode
     * @param {(store: IDBObjectStore) => IDBRequest} action
     * @returns {Promise<*>} 事务完成后返回最后一个请求的 result
     */
    function runTransaction(db, mode, action) {
        return new Promise(function (resolve, reject) {
            var transaction;
            try {
                transaction = db.transaction(STORE_NAME, mode);
            } catch (error) {
                reject(error);
                return;
            }

            var request;
            try {
                request = action(transaction.objectStore(STORE_NAME));
            } catch (error) {
                try {
                    transaction.abort();
                } catch (e) { /* 忽略 */ }
                reject(error);
                return;
            }

            transaction.oncomplete = function () {
                resolve(request ? request.result : undefined);
            };
            transaction.onerror = function () {
                reject(transaction.error || (request && request.error) || new Error('IndexedDB 事务失败'));
            };
            transaction.onabort = function () {
                reject(transaction.error || new Error('IndexedDB 事务已中止'));
            };
        });
    }

    function readRaw(db, key) {
        return runTransaction(db, 'readonly', function (store) {
            return store.get(key);
        });
    }

    function writeRaw(db, key, value) {
        return runTransaction(db, 'readwrite', function (store) {
            return store.put(value, key);
        });
    }

    function deleteRaw(db, key) {
        return runTransaction(db, 'readwrite', function (store) {
            return store.delete(key);
        });
    }

    // ======================== 旧数据迁移 ========================

    function readLegacy(key) {
        try {
            return window.localStorage ? window.localStorage.getItem(key) : null;
        } catch (e) {
            return null;
        }
    }

    function removeLegacy(key) {
        try {
            if (window.localStorage) window.localStorage.removeItem(key);
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 把旧版 localStorage 里的缓存搬进 IndexedDB。
     * 逐个键处理：写成功才删除旧键，避免迁移中途失败导致数据丢失。
     */
    function migrateLegacy(db) {
        return readRaw(db, MIGRATION_KEY).then(function (migrated) {
            if (migrated) return null;

            var legacyKeys = Object.keys(KEYS).map(function (name) {
                return KEYS[name];
            });

            return legacyKeys.reduce(function (chain, key) {
                return chain.then(function () {
                    return readRaw(db, key);
                }).then(function (existing) {
                    if (existing !== undefined && existing !== null) {
                        // 新库里已有数据，旧键直接丢弃
                        removeLegacy(key);
                        return null;
                    }
                    var raw = readLegacy(key);
                    if (raw == null) return null;

                    var value;
                    try {
                        value = JSON.parse(raw);
                    } catch (error) {
                        console.warn('[ZMD.storage] 旧缓存解析失败，已跳过:', key, error);
                        removeLegacy(key);
                        return null;
                    }

                    return writeRaw(db, key, value).then(function () {
                        memory[key] = value;
                        removeLegacy(key);
                    });
                });
            }, Promise.resolve()).then(function () {
                return writeRaw(db, MIGRATION_KEY, true);
            });
        });
    }

    // ======================== 连接管理 ========================

    /**
     * 打开数据库（只执行一次）并完成旧数据迁移。
     * 失败时不抛给调用方，而是在内部标记为不可用。
     * @returns {Promise<IDBDatabase>}
     */
    function ensureReady() {
        if (opening) return opening;

        if (!supported) {
            opening = Promise.reject(new Error('当前浏览器或页面环境不支持 IndexedDB'));
            opening.catch(function () { /* 由各调用方兜底 */ });
            return opening;
        }

        opening = openDatabase().then(function (db) {
            database = db;

            // 其他标签页升级数据库版本时主动让出连接
            db.onversionchange = function () {
                try {
                    db.close();
                } catch (e) { /* 忽略 */ }
                database = null;
                opening = null;
            };

            return migrateLegacy(db).catch(function (error) {
                console.warn('[ZMD.storage] 旧缓存迁移失败，已跳过:', error);
                return null;
            }).then(function () {
                return db;
            });
        }).catch(function (error) {
            broken = true;
            console.warn('[ZMD.storage] IndexedDB 不可用，已退回内存缓存:', error && error.message);
            throw error;
        });

        opening.catch(function () { /* 由各调用方兜底 */ });
        return opening;
    }

    // ======================== 对外读写接口 ========================

    /**
     * 读取缓存。
     * @param {string} key
     * @returns {Promise<*|null>} 不存在或读取失败时返回 null
     */
    function readJSON(key) {
        var task = database
            ? readRaw(database, key)
            : ensureReady().then(function (db) {
                return readRaw(db, key);
            });

        return task.then(function (value) {
            if (value === undefined || value === null) {
                return memory[key] === undefined ? null : memory[key];
            }
            memory[key] = value;
            return value;
        }).catch(function () {
            return memory[key] === undefined ? null : memory[key];
        });
    }

    /**
     * 写入缓存。
     * @param {string} key
     * @param {*} value 可被结构化克隆的数据（对象 / 数组 / 字符串 / 数字等）
     * @returns {Promise<boolean>} 是否成功（配额不足等失败情况返回 false）
     */
    function writeJSON(key, value) {
        memory[key] = value;

        var task = database
            ? writeRaw(database, key, value)
            : ensureReady().then(function (db) {
                return writeRaw(db, key, value);
            });

        return task.then(function () {
            return true;
        }).catch(function (error) {
            if (!warned[key]) {
                warned[key] = true;
                console.warn('[ZMD.storage] 保存失败（将只在本次会话中有效）:', key, error && (error.name || error.message));
            }
            return false;
        });
    }

    /**
     * 删除单个键。
     * @returns {Promise<boolean>}
     */
    function remove(key) {
        delete memory[key];

        var task = database
            ? deleteRaw(database, key)
            : ensureReady().then(function (db) {
                return deleteRaw(db, key);
            });

        return task.then(function () {
            return true;
        }).catch(function (error) {
            if (!warned[key]) {
                warned[key] = true;
                console.warn('[ZMD.storage] 删除失败:', key, error && (error.name || error.message));
            }
            return false;
        });
    }

    /** 清空本应用占用的所有键（不影响同域其他数据）。 */
    function clearAll() {
        return Promise.all(Object.keys(KEYS).map(function (name) {
            return remove(KEYS[name]);
        })).then(function () {
            return true;
        });
    }

    ZMD.storage = {
        KEYS: KEYS,
        DB_NAME: DB_NAME,
        /** 是否真的能持久化（IndexedDB 可用且已成功打开） */
        get available() {
            return supported && !broken;
        },
        /** 提前打开数据库（可选，读写时会自动调用） */
        init: ensureReady,
        readJSON: readJSON,
        writeJSON: writeJSON,
        remove: remove,
        clearAll: clearAll
    };
})(window.ZMD);
