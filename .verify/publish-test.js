/**
 * 发布脚本自检（只读校验，全部操作在系统临时目录里完成）。
 *
 * 验证：
 *   1. dry-run 不写任何文件；
 *   2. data URL 被解码成独立图片文件，文件名带内容哈希；
 *   3. 相同图片只写一份（按内容哈希去重）；
 *   4. 空白角色被跳过，输出 JSON 里不含拥有状态字段；
 *   5. 重复发布同一内容时 publishedAt 保持不变、不重复写图；
 *   6. --prune 清理不再被引用的旧图。
 *
 * 运行：node .verify/publish-test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'publish-collection.mjs');

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

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zmd-publish-'));

function run(args) {
    return execFileSync(process.execPath, [SCRIPT].concat(args), {
        cwd: work,
        encoding: 'utf8'
    });
}

function dataUrl(text) {
    return 'data:image/webp;base64,' + Buffer.from(text).toString('base64');
}

// 两张角色头像内容相同（用于验证按内容去重），武器图不同
const avatarA = dataUrl('avatar-bytes-same');
const weaponA = dataUrl('weapon-bytes-a');

const draft = {
    schemaVersion: 2,
    publishedAt: '2026-10-01T00:00:00.000Z',
    versions: [
        {
            id: 'v_test',
            name: '2.1「星尘」',
            characters: [
                {
                    id: 'c_alpha',
                    name: '星辉',
                    avatar: avatarA,
                    weaponName: '星辉之刃',
                    weaponImage: weaponA,
                    owned: true,
                    weaponOwned: true
                },
                {
                    id: 'c_beta',
                    name: '凛',
                    avatar: avatarA,
                    weaponName: '',
                    weaponImage: '',
                    owned: false,
                    weaponOwned: false
                },
                {
                    id: 'c_blank',
                    name: '',
                    avatar: '',
                    weaponName: '',
                    weaponImage: ''
                }
            ]
        }
    ]
};

fs.mkdirSync(path.join(work, 'tools'), { recursive: true });
fs.writeFileSync(path.join(work, 'tools', 'collection-draft.json'), JSON.stringify(draft, null, 2));

const DATA = path.join(work, 'data', 'collection.json');
const IMAGES = path.join(work, 'assets', 'collection');

function images() {
    try {
        return fs.readdirSync(IMAGES).sort();
    } catch (e) {
        return [];
    }
}

section('【1】dry-run 不写文件');
const dryOutput = run(['--dry-run']);
ok(!fs.existsSync(DATA), 'dry-run 没有生成 data/collection.json');
ok(images().length === 0, 'dry-run 没有生成图片');
ok(/2 个角色/.test(dryOutput), 'dry-run 统计到 2 个角色', dryOutput);

section('【2】正式生成');
const firstOutput = run(['--prune']);
ok(fs.existsSync(DATA), '生成 data/collection.json');
const doc = readJSON(DATA);
ok(doc.schemaVersion === 2, 'schemaVersion 为 2');
ok(doc.versions.length === 1, '1 个版本');
ok(doc.versions[0].characters.length === 2, '空白角色被跳过（2 个角色）', doc.versions[0].characters.length);
ok(doc.publishedAt && doc.publishedAt !== '2026-10-01T00:00:00.000Z', 'publishedAt 使用发布时间');
ok(doc.versions[0].characters.every((c) => !('owned' in c) && !('weaponOwned' in c)), '输出不含拥有状态字段');
ok(doc.versions[0].characters[0].id === 'c_alpha', '角色 id 原样保留');
ok(/^assets\/collection\/c_alpha-[0-9a-f]{8}\.webp$/.test(doc.versions[0].characters[0].avatar),
    '头像改为带内容哈希的相对路径', doc.versions[0].characters[0].avatar);
ok(doc.versions[0].characters[0].weaponImage.indexOf('c_alpha-weapon-') >= 0,
    '武器图使用 -weapon 前缀');
ok(/^assets\/collection\/c_beta-[0-9a-f]{8}\.webp$/.test(doc.versions[0].characters[1].avatar),
    '每个角色的图片以自身 id 命名，便于排查', doc.versions[0].characters[1].avatar);
ok(images().length === 3, '生成 3 个图片文件（两个头像 + 一把武器）', images());
ok(/本次写入 3 张图片/.test(firstOutput), '统计显示写入 3 张图片', firstOutput);

section('【3】重复发布保持稳定');
const firstPublishedAt = doc.publishedAt;
const secondOutput = run(['--prune']);
const second = readJSON(DATA);
ok(second.publishedAt === firstPublishedAt, '内容未变时 publishedAt 不变');
ok(images().length === 3, '图片文件没有重复写入', images());
ok(/内容与上次发布一致/.test(secondOutput), '提示内容与上次一致', secondOutput);
ok(/本次写入 0 张图片/.test(secondOutput), '没有新增图片写入', secondOutput);

section('【4】--prune 清理孤儿图片');
fs.writeFileSync(path.join(IMAGES, 'c_deleted-deadbeef.webp'), 'orphan');
ok(images().length === 4, '已放入一张孤儿图片');
const pruneOutput = run(['--prune']);
ok(images().length === 3, '孤儿图片被删除', images());
ok(/清理未引用图片：c_deleted-deadbeef\.webp/.test(pruneOutput), '清理日志正确', pruneOutput);

section('【5】缺少 id 时明确报错');
fs.writeFileSync(path.join(work, 'tools', 'bad.json'),
    JSON.stringify({ versions: [{ name: 'X', characters: [{ name: '无 id 角色' }] }] }));
let failed = false;
let errorText = '';
try {
    run(['--input', path.join(work, 'tools', 'bad.json')]);
} catch (error) {
    failed = true;
    errorText = String(error.stdout || '') + String(error.stderr || '');
}
ok(failed, '缺少 id 时脚本以非 0 退出');
ok(/缺少 id/.test(errorText), '错误信息提示缺少 id', errorText);

fs.rmSync(work, { recursive: true, force: true });

console.log('\n' + (failures === 0
    ? '✅ 全部通过（' + checks + ' 项检查）'
    : '❌ 有 ' + failures + ' 项检查未通过（共 ' + checks + ' 项）'));

process.exit(failures === 0 ? 0 : 1);
