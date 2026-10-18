/**
 * 发布数据层自检（只读校验，不修改交付文件）。
 *
 * 验证：
 *   1. 新建角色 / 版本都带稳定 id，且互不重复；
 *   2. 发布文档不含任何个人拥有状态；
 *   3. 用远端内容覆盖（applyRemote）后，勾选按 id 保留、id 不变；
 *   4. 编辑弹窗整体替换角色列表时 id 不变（勾选不会丢）；
 *   5. 旧数据（无 id）迁移出的 id 具有确定性，重复迁移结果一致；
 *   6. 远端删掉中间的角色后，勾选不会串到别的角色上。
 *
 * 运行：node .verify/publish-data-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let failures = 0;
let checks = 0;

function ok(condition, label, extra) {
    checks += 1;
    if (condition) {
        console.log('  ✅ ' + label);
    } else {
        failures += 1;
        console.log('  ❌ ' + label + (extra === undefined ? '' : '  → ' + extra));
    }
}

function section(title) {
    console.log('\n' + title);
}

/** 只加载数据层脚本（不需要界面），storage 会自动退回内存缓存 */
function createStore() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://example.com/collection.html',
        runScripts: 'outside-only'
    });
    const files = [
        'js/core/namespace.js',
        'js/core/util.js',
        'js/core/storage.js',
        'js/core/collection-store.js'
    ];
    files.forEach((file) => {
        dom.window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    });
    return dom.window.ZMD.collectionStore;
}

async function main() {
    const store = createStore();

    section('【1】新建内容带稳定 id');
    store.addVersion({
        name: '2.1「星尘」',
        characters: [
            { name: '星辉', weaponName: '星辉之刃' },
            { name: '凛' }
        ]
    });

    const version = store.getVersion(0);
    ok(/^v_/.test(version.id), '版本带 id', version.id);
    ok(/^c_/.test(version.characters[0].id), '角色带 id', version.characters[0].id);
    ok(version.characters[0].id !== version.characters[1].id, '角色 id 互不重复');

    section('【2】发布文档剥离拥有状态');
    store.setCharacterField(0, 0, 'owned', true);
    store.setCharacterField(0, 0, 'weaponOwned', true);
    store.setCharacterField(0, 1, 'owned', true);

    const doc = store.toPublishDoc();
    const published = doc.versions[0].characters[0];
    ok(!('owned' in published) && !('weaponOwned' in published), '发布文档不含 owned / weaponOwned');
    ok(published.id === version.characters[0].id, '发布文档保留角色 id');
    ok(doc.schemaVersion === 2, 'schemaVersion 为 2');
    ok(!!doc.publishedAt, '带 publishedAt');

    section('【3】远端内容覆盖后勾选保留');
    const alphaId = version.characters[0].id;
    const betaId = version.characters[1].id;
    await store.applyRemote(doc);

    ok(store.getCharacter(0, 0).id === alphaId, '覆盖后第一个角色 id 不变');
    ok(store.getCharacter(0, 0).owned === true, '覆盖后「拥有角色」保留');
    ok(store.getCharacter(0, 0).weaponOwned === true, '覆盖后「拥有专武」保留');
    ok(store.getCharacter(0, 1).owned === true, '第二个角色的勾选同样保留');

    section('【4】编辑整体替换列表时 id 不变');
    store.updateVersion(0, {
        name: '2.1「星尘」',
        characters: [
            { id: alphaId, name: '星辉（改名）', weaponName: '星辉之刃', owned: true, weaponOwned: true },
            { id: betaId, name: '凛', owned: true }
        ]
    });

    ok(store.getCharacter(0, 0).id === alphaId, '改名后 id 不变（勾选不会失效）');
    ok(store.getCharacter(0, 0).owned === true, '改名后勾选仍在');

    section('【5】旧数据迁移 id 确定性');
    await store.reset();
    const legacy = {
        versions: [{
            name: '1.0 旧版本',
            characters: [
                { name: '旧角色甲', owned: true, weaponOwned: false },
                { name: '旧角色乙', owned: false, weaponOwned: true }
            ]
        }]
    };

    await store.applyRemote(legacy);
    const legacyIdA = store.getCharacter(0, 0).id;
    const legacyIdB = store.getCharacter(0, 1).id;

    ok(/^c_/.test(legacyIdA), '旧角色补上了 id', legacyIdA);
    ok(legacyIdA !== legacyIdB, '不同角色迁移出的 id 不同');
    ok(store.getCharacter(0, 0).owned === true, '旧缓存里的勾选保留');
    ok(store.getCharacter(0, 1).weaponOwned === true, '旧缓存里的专武勾选保留');

    // 同样的旧数据再迁移一次（例如站长与访客各自打开页面），id 必须一致
    await store.reset();
    await store.applyRemote(JSON.parse(JSON.stringify(legacy)));
    ok(store.getCharacter(0, 0).id === legacyIdA, '同一份旧数据迁移出的 id 稳定不变');
    ok(store.getCharacter(0, 1).id === legacyIdB, '第二个旧角色同样稳定');

    section('【6】远端删除中间角色后勾选不串位');
    await store.reset();
    store.addVersion({
        name: '3.0',
        characters: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
    });
    const ids = store.getVersion(0).characters.map((c) => c.id);
    store.setCharacterField(0, 2, 'owned', true);   // 只勾选第三个

    // 模拟站长删掉了中间的角色 B 后重新发布
    const next = store.toPublishDoc();
    next.versions[0].characters = [next.versions[0].characters[0], next.versions[0].characters[2]];
    await store.applyRemote(next);

    ok(store.getVersion(0).characters.length === 2, '远端内容生效（剩 2 个角色）');
    ok(store.getCharacter(0, 0).id === ids[0], '第一个角色仍是 A');
    ok(store.getCharacter(0, 1).id === ids[2], '第二个角色变成 C（不是原来的 B）');
    ok(store.getCharacter(0, 0).owned === false, 'A 没有被误勾选');
    ok(store.getCharacter(0, 1).owned === true, 'C 的勾选跟随角色本身保留');

    console.log('\n' + (failures === 0
        ? '✅ 全部通过（' + checks + ' 项检查）'
        : '❌ 有 ' + failures + ' 项检查未通过（共 ' + checks + ' 项）'));

    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('❌ 测试执行失败：', error);
    process.exit(1);
});
