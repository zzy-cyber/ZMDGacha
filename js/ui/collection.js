/**
 * 角色 & 武器收集统计界面。
 *
 * 布局约定（与上一版不同）：
 *  - 「添加 / 编辑版本」只用于填写信息，放在弹窗里，不在主页单独占一块；
 *  - 主页只负责展示清单：**一个角色 + 它的一把专武占一整行**，下一个角色在下一行；
 *  - 是否拥有角色 / 专武也在主页的行内勾选，勾选立即更新统计；
 *  - 图片上传在弹窗内完成，保存后主页才写入图片。
 *
 * 渲染策略与主页面一致：
 *  - 弹窗里的名称输入直接写草稿（draft），不重绘，避免打断输入；
 *  - 主页只有勾选与删除，勾选后整体重绘并还原焦点；
 *  - 事件全部用事件委托，重绘不会重复绑定。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;
    var store = ZMD.collectionStore;
    var calc = ZMD.collectionCalc;
    var imageUtil = ZMD.imageUtil;

    var el = {};
    /** 弹窗草稿：取消时丢弃，保存时才写入 store */
    var draft = null;
    /** 待接收文件的图片槽位 { kind, char } */
    var pendingImage = null;

    function cacheElements() {
        el.list = util.$('collectionList');
        el.addVersion = util.$('btnAddVersion');
        el.fileInput = util.$('imageFileInput');
        el.filterButtons = util.$$('.filter-btn');

        el.charOwned = util.$('statCharOwned');
        el.charTotal = util.$('statCharTotal');
        el.charPercent = util.$('statCharPercent');
        el.charBar = util.$('statCharBar');
        el.weaponOwned = util.$('statWeaponOwned');
        el.weaponBase = util.$('statWeaponBase');
        el.weaponPercent = util.$('statWeaponPercent');
        el.weaponBar = util.$('statWeaponBar');
        el.weaponNote = util.$('statWeaponNote');
        el.statMeta = util.$('statMeta');

        el.editorOverlay = util.$('editorOverlay');
        el.editorTitle = util.$('editorTitle');
        el.editorVersionName = util.$('editorVersionName');
        el.editorChars = util.$('editorChars');
        el.editorAddChar = util.$('btnEditorAddChar');
        el.editorClose = util.$('btnCloseEditor');
        el.editorCancel = util.$('btnCancelEditor');
        el.editorSave = util.$('btnSaveEditor');
    }

    // ======================== 弹窗草稿 ========================

    function blankCharacter() {
        return {
            name: '',
            avatar: '',
            weaponName: '',
            weaponImage: '',
            owned: false,
            weaponOwned: false
        };
    }

    function cloneCharacter(character) {
        return {
            name: String(character.name || ''),
            avatar: String(character.avatar || ''),
            weaponName: String(character.weaponName || ''),
            weaponImage: String(character.weaponImage || ''),
            owned: !!character.owned,
            weaponOwned: !!character.weaponOwned
        };
    }

    function isEditorOpen() {
        return !!el.editorOverlay && el.editorOverlay.classList.contains('show');
    }

    // ======================== 弹窗渲染 ========================

    /** 弹窗内的图片槽位（上传 / 移除都只改草稿，不影响主页）。 */
    function editorImageSlot(kind, source, alt, characterIndex) {
        var preset = imageUtil.PRESETS[kind];
        var hasImage = !!source;
        var clearButton = hasImage
            ? '<button class="image-clear" type="button" data-action="clear-draft-image" data-kind="' + kind + '"' +
                ' data-char="' + characterIndex + '" title="移除' + preset.label + '"' +
                ' aria-label="移除' + preset.label + '">✕</button>'
            : '';

        return '' +
            '<div class="media-shell">' +
                '<button class="media-slot media-' + kind + (hasImage ? ' is-filled' : '') + '" type="button"' +
                    ' data-action="pick-draft-image" data-kind="' + kind + '" data-char="' + characterIndex + '"' +
                    ' title="点击上传' + preset.label + '（建议 ' + preset.sizeText + '）">' +
                    (hasImage
                        ? '<img src="' + util.escapeHTML(source) + '" alt="' + util.escapeHTML(alt) + '">'
                        : '<span class="media-placeholder">' +
                            '<span class="media-plus">＋</span>' +
                            '<span>上传' + (kind === 'avatar' ? '头像' : '武器图') + '</span>' +
                            '<span class="media-size">' + preset.sizeText + '</span>' +
                          '</span>') +
                '</button>' +
                clearButton +
            '</div>';
    }

    /** 弹窗里的单个角色编辑块 */
    function editorCharacter(character, index) {
        var name = String(character.name || '');
        var weaponName = String(character.weaponName || '');
        var nameLabel = name.trim() || '未命名角色';

        return '' +
            '<div class="editor-char" data-char="' + index + '">' +
                '<div class="editor-char-head">' +
                    '<span class="editor-char-index">角色 ' + (index + 1) + '</span>' +
                    '<button class="char-delete" type="button" data-action="remove-draft-char"' +
                        ' data-char="' + index + '" title="移除这个角色"' +
                        ' aria-label="移除角色 ' + util.escapeHTML(nameLabel) + '">✕</button>' +
                '</div>' +
                '<div class="editor-char-grid">' +
                    '<div class="editor-media">' +
                        editorImageSlot('avatar', character.avatar, nameLabel + ' 的头像', index) +
                        '<span class="media-caption">角色头像 · 456×564</span>' +
                    '</div>' +
                    '<div class="editor-fields">' +
                        '<label class="field-label">🎭 角色名称</label>' +
                        '<input type="text" class="editor-input" data-field="name" data-char="' + index + '"' +
                            ' value="' + util.escapeHTML(name) + '" placeholder="例如：星辉" maxlength="32">' +
                        '<label class="field-label">🗡️ 专武名称（可选）</label>' +
                        '<input type="text" class="editor-input" data-field="weaponName" data-char="' + index + '"' +
                            ' value="' + util.escapeHTML(weaponName) + '" placeholder="例如：星辉之刃"' +
                            ' maxlength="40">' +
                    '</div>' +
                    '<div class="editor-media">' +
                        editorImageSlot('weapon', character.weaponImage, nameLabel + ' 的专武', index) +
                        '<span class="media-caption">武器图片 · 256×256</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    function renderEditor() {
        if (!draft) return;
        if (el.editorTitle) {
            el.editorTitle.textContent = draft.mode === 'create' ? '＋ 添加版本' : '✎ 编辑版本';
        }
        if (el.editorVersionName) el.editorVersionName.value = draft.name;

        if (!el.editorChars) return;
        if (draft.characters.length === 0) {
            el.editorChars.innerHTML = '<p class="editor-empty">还没有角色，点击下方「＋ 添加角色」。</p>';
        } else {
            el.editorChars.innerHTML = draft.characters.map(editorCharacter).join('');
        }
    }

    function openEditor(options) {
        var opts = options || {};
        var hasVersion = opts.versionIndex !== null && opts.versionIndex !== undefined;
        var version = hasVersion ? store.getVersion(opts.versionIndex) : null;
        if (hasVersion && !version) return;

        draft = {
            mode: hasVersion ? 'edit' : 'create',
            versionIndex: hasVersion ? opts.versionIndex : null,
            name: version ? String(version.name || '') : '',
            characters: version
                ? version.characters.map(cloneCharacter)
                : [blankCharacter()]
        };
        if (opts.addCharacter) draft.characters.push(blankCharacter());

        if (el.editorOverlay) el.editorOverlay.classList.add('show');
        renderEditor();

        var focusIndex = opts.addCharacter
            ? draft.characters.length - 1
            : (opts.focusChar !== undefined ? opts.focusChar : null);

        setTimeout(function () {
            if (!draft) return;
            var target = null;
            if (focusIndex !== null && el.editorChars) {
                target = el.editorChars.querySelector(
                    '.editor-char[data-char="' + focusIndex + '"] [data-field="name"]');
            }
            if (!target) target = el.editorVersionName;
            if (target && target.focus) target.focus();
        }, 30);
    }

    function closeEditor() {
        if (el.editorOverlay) el.editorOverlay.classList.remove('show');
        draft = null;
        pendingImage = null;
        if (el.fileInput) el.fileInput.value = '';
    }

    function saveEditor() {
        if (!draft) return;

        // 以输入框里的最新值为准（输入事件已经同步，这里再兜底一次）
        var name = String(el.editorVersionName ? el.editorVersionName.value : draft.name).trim();
        draft.name = name;

        // 完全空白的角色不写入，避免手滑点「添加角色」留下空行
        var characters = draft.characters.filter(function (character) {
            return String(character.name || '').trim() ||
                character.avatar ||
                String(character.weaponName || '').trim() ||
                character.weaponImage;
        });

        if (draft.mode === 'create' && !String(name).trim() && characters.length === 0) {
            ZMD.toast.show('请填写版本名称或至少添加一个角色');
            return;
        }

        var data = { name: name, characters: characters };
        var previousVersions = JSON.parse(JSON.stringify(store.getState().versions));
        var isCreate = draft.mode === 'create';
        var createdIndex = null;

        if (isCreate) {
            createdIndex = store.addVersion(data);
        } else {
            store.updateVersion(draft.versionIndex, data);
        }

        // 写入缓存失败（通常是图片太多、localStorage 空间不足）时整体回滚，
        // 保持「界面 = 缓存」；弹窗不关闭，用户减少图片后可以直接重试。
        if (!store.save() && canPersist()) {
            store.restoreVersions(previousVersions);
            store.save();
            ZMD.toast.show('❌ 本地缓存空间不足，本次修改已撤销；请减少图片后重试');
            return;
        }

        closeEditor();
        ZMD.toast.show(isCreate ? '✅ 已添加版本 ' + (createdIndex + 1) : '✅ 版本信息已更新');
    }

    // ======================== 主页清单 ========================

    function rosterThumb(kind, source, alt) {
        if (source) {
            return '<div class="roster-thumb roster-thumb-' + kind + '">' +
                '<img src="' + util.escapeHTML(source) + '" alt="' + util.escapeHTML(alt) + '">' +
                '</div>';
        }
        return '<div class="roster-thumb roster-thumb-' + kind + ' is-empty" aria-hidden="true">' +
            '<span>' + (kind === 'avatar' ? '🎭' : '🗡️') + '</span></div>';
    }

    /** 一行 = 一个角色 + 它的一把专武 */
    function rosterRow(character, versionIndex, characterIndex) {
        var name = String(character.name || '').trim() || '未命名角色';
        var weaponName = String(character.weaponName || '').trim() || '未命名专武';
        var rowClass = 'roster-row' +
            (character.owned ? ' is-owned' : '') +
            (character.weaponOwned ? ' is-weapon-owned' : '');

        return '' +
            '<div class="' + rowClass + '" data-version="' + versionIndex + '" data-char="' + characterIndex + '">' +
                '<div class="roster-unit roster-character">' +
                    rosterThumb('avatar', character.avatar, name + ' 的头像') +
                    '<div class="roster-meta">' +
                        '<span class="roster-name">' + util.escapeHTML(name) + '</span>' +
                        '<span class="roster-sub">🎭 角色</span>' +
                    '</div>' +
                    '<label class="own-check">' +
                        '<input type="checkbox" data-version="' + versionIndex + '"' +
                            ' data-char="' + characterIndex + '" data-field="owned"' +
                            (character.owned ? ' checked' : '') + '>' +
                        '<span>拥有角色</span>' +
                    '</label>' +
                '</div>' +
                '<span class="roster-divider" aria-hidden="true"></span>' +
                '<div class="roster-unit roster-weapon">' +
                    rosterThumb('weapon', character.weaponImage, weaponName) +
                    '<div class="roster-meta">' +
                        '<span class="roster-name">' + util.escapeHTML(weaponName) + '</span>' +
                        '<span class="roster-sub">🗡️ 专武</span>' +
                    '</div>' +
                    '<label class="own-check weapon-check" title="专武持有率只在「已拥有角色」中统计">' +
                        '<input type="checkbox" data-version="' + versionIndex + '"' +
                            ' data-char="' + characterIndex + '" data-field="weaponOwned"' +
                            (character.weaponOwned ? ' checked' : '') + '>' +
                        '<span>拥有专武</span>' +
                    '</label>' +
                '</div>' +
                '<div class="roster-row-actions">' +
                    '<button class="row-icon-btn" type="button" data-action="edit-version"' +
                        ' data-version="' + versionIndex + '" data-char="' + characterIndex + '"' +
                        ' title="编辑这个角色与专武" aria-label="编辑角色 ' + util.escapeHTML(name) + '">✎</button>' +
                    '<button class="row-icon-btn row-delete" type="button" data-action="delete-character"' +
                        ' data-version="' + versionIndex + '" data-char="' + characterIndex + '"' +
                        ' title="删除这个角色" aria-label="删除角色 ' + util.escapeHTML(name) + '">✕</button>' +
                '</div>' +
            '</div>';
    }

    function versionGroup(version, versionIndex, filter) {
        var stats = calc.versionStats(version);
        var visible = calc.filterCharacters(version, filter);
        var name = String(version.name || '').trim() || '未命名版本';
        var emptyText = version.characters.length === 0
            ? '这个版本还没有角色，点击「＋ 添加角色」填写。'
            : '当前筛选下没有符合条件的角色。';

        var list = visible.length
            ? '<div class="roster-list">' + visible.map(function (entry) {
                return rosterRow(entry.character, versionIndex, entry.index);
            }).join('') + '</div>'
            : '<p class="filter-empty">' + emptyText + '</p>';

        return '' +
            '<section class="version-group" data-version="' + versionIndex + '">' +
                '<header class="version-head">' +
                    '<span class="version-title">📌 ' + util.escapeHTML(name) + '</span>' +
                    '<span class="version-stat" title="角色拥有率">🎭 <b>' + stats.owned + '/' + stats.total + '</b>' +
                        ' · ' + calc.formatPercent(stats.charRate) + '</span>' +
                    '<span class="version-stat stat-weapon" title="已拥有角色的专武持有率">🗡️ <b>' +
                        stats.ownedWithWeapon + '/' + stats.owned + '</b> · ' +
                        calc.formatPercent(stats.weaponRate) + '</span>' +
                    '<span class="version-actions">' +
                        '<button class="btn-add-char" type="button" data-action="add-character"' +
                            ' data-version="' + versionIndex + '">＋ 添加角色</button>' +
                        '<button class="btn-edit-version" type="button" data-action="edit-version"' +
                            ' data-version="' + versionIndex + '">✎ 编辑</button>' +
                        '<button class="btn-delete" type="button" data-action="delete-version"' +
                            ' data-version="' + versionIndex + '" title="删除此版本">🗑️ 删除</button>' +
                    '</span>' +
                '</header>' +
                list +
            '</section>';
    }

    // ======================== 统计 ========================

    function setText(element, text) {
        if (element) element.textContent = text;
    }

    function setBar(element, rate) {
        if (!element) return;
        var percent = util.clamp((Number(rate) || 0) * 100, 0, 100);
        element.style.width = percent + '%';
    }

    function renderStats() {
        var state = store.getState();
        var stats = calc.overallStats(state.versions);

        setText(el.charOwned, String(stats.owned));
        setText(el.charTotal, String(stats.total));
        setText(el.charPercent, calc.formatPercent(stats.charRate));
        setBar(el.charBar, stats.charRate);

        setText(el.weaponOwned, String(stats.ownedWithWeapon));
        setText(el.weaponBase, String(stats.owned));
        setText(el.weaponPercent, calc.formatPercent(stats.weaponRate));
        setBar(el.weaponBar, stats.weaponRate);
        setText(el.weaponNote, stats.owned > 0
            ? '统计范围：' + stats.owned + ' 名已拥有角色'
            : '拥有角色后开始统计');

        var weaponMeta = stats.weaponOwned > 0
            ? ' · 已拥有专武 ' + stats.weaponOwned + ' 把' +
                (stats.weaponOwned !== stats.ownedWithWeapon
                    ? '（其中 ' + stats.ownedWithWeapon + ' 把属于已拥有角色）'
                    : '')
            : '';

        setText(el.statMeta,
            stats.versionCount + ' 个版本 · ' + stats.total + ' 名角色 · ' +
            stats.owned + ' 名已拥有' + weaponMeta);

        el.filterButtons.forEach(function (button) {
            var filter = button.getAttribute('data-filter');
            var active = filter === state.filter;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            var count = button.querySelector('.filter-count');
            if (count) count.textContent = String(calc.countForFilter(stats, filter));
        });
    }

    // ======================== 主页渲染 ========================

    function renderList() {
        var state = store.getState();

        if (state.versions.length === 0) {
            el.list.innerHTML = '' +
                '<div class="collection-empty">' +
                    '<span class="empty-icon">📚</span>' +
                    '<p class="empty-title">还没有任何版本</p>' +
                    '<p class="empty-desc">先点击「＋ 添加版本」填写版本与角色信息；<br>' +
                        '保存后角色与专武会按「一行一个角色」显示在这里。</p>' +
                    '<button class="btn btn-add" type="button" data-action="add-version">＋ 添加版本</button>' +
                '</div>';
            return;
        }

        el.list.innerHTML = state.versions.map(function (version, index) {
            return versionGroup(version, index, state.filter);
        }).join('');
    }

    function render() {
        renderStats();
        renderList();
    }

    // ======================== 持久化 ========================

    /**
     * 浏览器是否真的能写入 localStorage。
     * 不可用时 store 会退回内存保存：数据在本次会话有效，刷新后丢失，
     * 此时不应该报「空间不足」，否则会误导用户。
     */
    function canPersist() {
        return !!(ZMD.storage && ZMD.storage.available);
    }

    /** 立即保存，并在失败时给出提示。 */
    function persist() {
        var ok = store.save();
        if (!ok && canPersist()) ZMD.toast.show('❌ 本地缓存写入失败，可能空间不足');
        return ok || !canPersist();
    }

    // ======================== 弹窗图片 ========================

    function handleFileChange() {
        var target = pendingImage;
        var files = el.fileInput && el.fileInput.files;
        var file = files && files[0];

        if (!target || !file || !draft || !draft.characters[target.char]) {
            pendingImage = null;
            if (el.fileInput) el.fileInput.value = '';
            return;
        }

        var preset = imageUtil.PRESETS[target.kind];
        ZMD.toast.show('⏳ 正在处理' + preset.label + '…');

        imageUtil.processFile(file, target.kind).then(function (result) {
            if (!draft || !draft.characters[target.char]) return;
            draft.characters[target.char][target.kind === 'avatar' ? 'avatar' : 'weaponImage'] = result.dataUrl;
            renderEditor();
            ZMD.toast.show('✅ ' + preset.label + '已添加，保存后生效（' +
                Math.max(1, Math.round(result.bytes / 1024)) + 'KB）');
        }).catch(function (error) {
            ZMD.toast.show('❌ ' + (error && error.message ? error.message : '图片处理失败'));
        }).then(function () {
            pendingImage = null;
            if (el.fileInput) el.fileInput.value = '';
        });
    }

    // ======================== 主页交互 ========================

    /** 记住勾选框焦点，重绘后放回去，便于键盘连续勾选。 */
    function captureCheckboxFocus(target) {
        if (!target || target.type !== 'checkbox') return null;
        var field = target.getAttribute('data-field');
        var version = target.getAttribute('data-version');
        var char = target.getAttribute('data-char');
        if (!field || version === null || char === null) return null;
        return { field: field, version: version, char: char };
    }

    function restoreCheckboxFocus(snapshot) {
        if (!snapshot) return;
        var selector = 'input[type="checkbox"][data-field="' + snapshot.field + '"]' +
            '[data-version="' + snapshot.version + '"][data-char="' + snapshot.char + '"]';
        var next = el.list.querySelector(selector);
        if (next && next.focus) next.focus();
    }

    function handleListClick(event) {
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (!target) return;

        var action = target.getAttribute('data-action');
        var versionIndex = util.toInt(target.getAttribute('data-version'));
        var characterIndex = util.toInt(target.getAttribute('data-char'));

        if (action === 'add-version') {
            openEditor();
            return;
        }

        if (action === 'edit-version') {
            openEditor({
                versionIndex: versionIndex,
                focusChar: target.hasAttribute('data-char') ? characterIndex : null
            });
            return;
        }

        if (action === 'add-character') {
            openEditor({ versionIndex: versionIndex, addCharacter: true });
            return;
        }

        if (action === 'delete-version') {
            deleteVersion(versionIndex);
            return;
        }

        if (action === 'delete-character') {
            deleteCharacter(versionIndex, characterIndex);
        }
    }

    function handleListChange(event) {
        var target = event.target;
        if (!target || target.type !== 'checkbox') return;
        var field = target.getAttribute('data-field');
        if (field !== 'owned' && field !== 'weaponOwned') return;

        var snapshot = captureCheckboxFocus(target);
        store.setCharacterField(
            util.toInt(target.getAttribute('data-version')),
            util.toInt(target.getAttribute('data-char')),
            field,
            target.checked
        );
        // store 的 notify 已同步重绘，这里直接把焦点还回新的勾选框
        restoreCheckboxFocus(snapshot);
    }

    // ======================== 弹窗交互 ========================

    function focusDraftCharacter(index) {
        setTimeout(function () {
            if (!draft || !el.editorChars) return;
            var input = el.editorChars.querySelector(
                '.editor-char[data-char="' + index + '"] [data-field="name"]');
            if (input && input.focus) input.focus();
        }, 30);
    }

    function handleEditorClick(event) {
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (!target) return;

        var action = target.getAttribute('data-action');
        var characterIndex = util.toInt(target.getAttribute('data-char'));

        if (action === 'add-draft-char') {
            if (!draft) return;
            draft.characters.push(blankCharacter());
            renderEditor();
            focusDraftCharacter(draft.characters.length - 1);
            return;
        }

        if (action === 'remove-draft-char') {
            if (!draft) return;
            draft.characters.splice(characterIndex, 1);
            renderEditor();
            return;
        }

        if (action === 'pick-draft-image') {
            if (!draft || !draft.characters[characterIndex]) return;
            pendingImage = { kind: target.getAttribute('data-kind'), char: characterIndex };
            if (el.fileInput) {
                el.fileInput.value = '';
                el.fileInput.click();
            }
            return;
        }

        if (action === 'clear-draft-image') {
            if (!draft || !draft.characters[characterIndex]) return;
            var field = target.getAttribute('data-kind') === 'avatar' ? 'avatar' : 'weaponImage';
            draft.characters[characterIndex][field] = '';
            renderEditor();
            ZMD.toast.show('已移除图片');
        }
    }

    function handleEditorInput(event) {
        if (!draft) return;
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var field = target.getAttribute('data-field');
        if (!field) return;

        if (field === 'versionName') {
            draft.name = target.value;
            return;
        }

        var characterIndex = util.toInt(target.getAttribute('data-char'));
        if (!draft.characters[characterIndex]) return;
        if (field !== 'name' && field !== 'weaponName') return;
        draft.characters[characterIndex][field] = target.value;
    }

    // ======================== 删除 ========================

    function deleteVersion(versionIndex) {
        var version = store.getVersion(versionIndex);
        if (!version) return;
        var name = String(version.name || '').trim() || ('版本 ' + (versionIndex + 1));
        var count = version.characters.length;
        var message = '确定删除「' + name + '」吗？' +
            (count ? '该版本下的 ' + count + ' 个角色也会一起删除。' : '') + '\n此操作不可恢复。';
        if (!window.confirm(message)) return;

        store.removeVersion(versionIndex);
        persist();
        ZMD.toast.show('🗑️ 已删除「' + name + '」');
    }

    function deleteCharacter(versionIndex, characterIndex) {
        var character = store.getCharacter(versionIndex, characterIndex);
        if (!character) return;
        var name = String(character.name || '').trim() || '未命名角色';
        if (!window.confirm('确定删除角色「' + name + '」吗？此操作不可恢复。')) return;

        store.removeCharacter(versionIndex, characterIndex);
        persist();
        ZMD.toast.show('🗑️ 已删除「' + name + '」');
    }

    // ======================== 绑定 ========================

    function bind() {
        util.on(el.list, 'click', handleListClick);
        util.on(el.list, 'change', handleListChange);

        util.on(el.addVersion, 'click', function () { openEditor(); });
        util.on(el.fileInput, 'change', handleFileChange);

        el.filterButtons.forEach(function (button) {
            util.on(button, 'click', function () {
                store.setFilter(button.getAttribute('data-filter'));
                persist();
            });
        });

        // 弹窗
        util.on(el.editorChars, 'click', handleEditorClick);
        util.onAll(el.editorChars, ['input'], handleEditorInput);
        util.on(el.editorVersionName, 'input', handleEditorInput);
        util.on(el.editorAddChar, 'click', function () {
            if (!draft) return;
            draft.characters.push(blankCharacter());
            renderEditor();
            focusDraftCharacter(draft.characters.length - 1);
        });
        util.on(el.editorClose, 'click', closeEditor);
        util.on(el.editorCancel, 'click', closeEditor);
        util.on(el.editorSave, 'click', saveEditor);

        util.on(el.editorOverlay, 'click', function (event) {
            if (event.target === el.editorOverlay) closeEditor();
        });

        util.on(document, 'keydown', function (event) {
            if (event.key === 'Escape' && isEditorOpen()) closeEditor();
        });
    }

    /** store 变化：主页重绘（弹窗草稿不受影响）。 */
    function handleStoreChange() {
        render();
    }

    function init() {
        cacheElements();
        bind();
        store.subscribe(handleStoreChange);
        render();
    }

    ZMD.ui = ZMD.ui || {};
    ZMD.ui.collection = {
        init: init,
        render: render,
        openEditor: openEditor,
        closeEditor: closeEditor
    };
})(window.ZMD);
