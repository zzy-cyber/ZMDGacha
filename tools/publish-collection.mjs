#!/usr/bin/env node
/**
 * 收集清单发布脚本（零依赖，Node 18+）。
 *
 * 做的事：
 *   1. 读取收集页导出的 collection-draft.json（图片仍是 data URL）；
 *   2. 把每张图片解码成独立文件，文件名带内容哈希（换图即换 URL，可长缓存）；
 *   3. 生成 data/collection.json（只含公共内容，不含任何拥有状态）；
 *   4. 可选：清理不再被引用的旧图；
 *   5. 可选：自动 git add / commit / push，交给 Cloudflare Pages 部署。
 *
 * 用法：
 *   npm run publish                  # 自动找「下载」里最新的草稿，清理旧图并推送
 *   npm run publish:dry              # 只看会发生什么，不写文件、不提交
 *   node tools/publish-collection.mjs --input ./collection-draft.json --prune
 *   node tools/publish-collection.mjs --auto --prune --git
 *
 * 参数：
 *   --auto          在「下载」目录（含 OneDrive 重定向）里找最新的 collection-draft*.json
 *   --input <path>  指定草稿路径
 *   --prune         删除 assets/collection 下不再被引用的图片
 *   --git           git add data assets → 有变更才 commit → push
 *   --dry-run       只打印结果，不写文件
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'data', 'collection.json');
const IMAGE_DIR = path.join(ROOT, 'assets', 'collection');
const DEFAULT_DRAFT = path.join(ROOT, 'tools', 'collection-draft.json');
const SCHEMA_VERSION = 2;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes('--' + name);
const getOption = (name) => {
    const index = argv.indexOf('--' + name);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[index + 1]
        : null;
};

const DRY_RUN = hasFlag('dry-run');
const AUTO = hasFlag('auto');
const PRUNE = hasFlag('prune');
const GIT = hasFlag('git');

/** data URL：data:image/webp;base64,XXXX */
const DATA_URL = /^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/;

function fail(message) {
    console.error('\n❌ ' + message + '\n');
    process.exit(1);
}

function log(message) {
    console.log(message);
}

function kb(bytes) {
    return (bytes / 1024).toFixed(0) + ' KB';
}

/** 文件名安全化：id 来自页面，正常是 c_xxx / v_xxx */
function sanitize(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

/** 在「下载」目录里找最新的一份草稿（兼容 OneDrive 重定向） */
async function findLatestDownload() {
    const dirs = [
        path.join(os.homedir(), 'Downloads'),
        path.join(os.homedir(), 'OneDrive', 'Downloads')
    ];

    let best = null;
    for (const dir of dirs) {
        let names;
        try {
            names = await readdir(dir);
        } catch {
            continue; // 目录不存在，换下一个
        }
        for (const name of names) {
            if (!/^collection-draft.*\.json$/i.test(name)) continue;
            const full = path.join(dir, name);
            let info;
            try {
                info = await stat(full);
            } catch {
                continue;
            }
            if (!best || info.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: info.mtimeMs };
        }
    }
    return best ? best.path : null;
}

async function resolveDraftPath() {
    const explicit = getOption('input');
    if (explicit) return path.resolve(explicit);

    if (AUTO) {
        const found = await findLatestDownload();
        if (found) return found;
        fail('在「下载」目录里没找到 collection-draft.json。\n' +
            '   请先在收集页点「📤 导出发布包」，或改用 --input <路径> 指定文件。');
    }

    return DEFAULT_DRAFT;
}

/**
 * 把一张图片落地为文件，返回 JSON 里保存的相对路径。
 * - data URL：解码 → 计算内容哈希 → 写入 assets/collection/；
 * - 已经是相对路径（重复发布时的旧数据）：原样保留。
 */
async function emitImage(value, baseName, ctx) {
    if (!value) return '';
    if (!String(value).startsWith('data:')) return String(value);

    const match = DATA_URL.exec(String(value));
    if (!match) {
        console.warn('   ⚠️ 跳过无法识别的图片数据（' + baseName + '）');
        return '';
    }

    const mime = match[1].toLowerCase();
    const ext = mime === 'jpeg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime;
    const buffer = Buffer.from(match[2], 'base64');
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 8);
    const fileName = baseName + '-' + hash + '.' + ext;

    ctx.used.add(fileName);

    if (ctx.seen.has(fileName)) return 'assets/collection/' + fileName;
    ctx.seen.add(fileName);

    const target = path.join(IMAGE_DIR, fileName);
    let exists = true;
    try {
        await stat(target);
    } catch {
        exists = false;
    }

    if (!exists) {
        if (!DRY_RUN) await writeFile(target, buffer);
        ctx.written++;
        ctx.bytes += buffer.length;
    }
    return 'assets/collection/' + fileName;
}

/** 内容比较（忽略 publishedAt），用于判断本次是否真的产生了变化 */
function sameContent(previous, next) {
    if (!previous || !Array.isArray(previous.versions)) return false;
    const strip = (doc) => JSON.stringify({ schemaVersion: doc.schemaVersion, versions: doc.versions });
    return strip(previous) === strip(next);
}

async function readPrevious() {
    try {
        return JSON.parse(await readFile(DATA_FILE, 'utf8'));
    } catch {
        return null;
    }
}

async function main() {
    const inputPath = await resolveDraftPath();
    log('\n📦 发布收集清单');
    log('   草稿：' + inputPath);
    if (DRY_RUN) log('   模式：dry-run（不写文件、不提交）');

    let draft;
    try {
        draft = JSON.parse(await readFile(inputPath, 'utf8'));
    } catch (error) {
        fail('读取草稿失败：' + (error && error.message ? error.message : '未知错误') +
            '\n   请先在收集页点「📤 导出发布包」。');
    }

    if (!draft || !Array.isArray(draft.versions)) {
        fail('草稿格式不对：缺少 versions 数组。');
    }

    // 图片目录必须提前建好：emitImage 会立即写文件
    if (!DRY_RUN) await mkdir(IMAGE_DIR, { recursive: true });

    const ctx = { used: new Set(), seen: new Set(), written: 0, bytes: 0 };
    const usedIds = new Set();
    const output = {
        schemaVersion: SCHEMA_VERSION,
        publishedAt: new Date().toISOString(),
        versions: []
    };

    let characterCount = 0;
    let skipped = 0;

    for (const rawVersion of draft.versions) {
        const characters = [];

        for (const rawCharacter of rawVersion.characters || []) {
            const id = sanitize(rawCharacter.id);
            if (!id) {
                fail('角色「' + (rawCharacter.name || '未命名') + '」缺少 id。\n' +
                    '   请先在收集页打开一次（会完成旧数据迁移），再重新导出。');
            }
            if (usedIds.has(id)) {
                fail('角色 id 重复：' + id + '（请检查是否手工改过 JSON）');
            }

            const name = String(rawCharacter.name || '').trim();
            const weaponName = String(rawCharacter.weaponName || '').trim();
            const hasImage = !!rawCharacter.avatar || !!rawCharacter.weaponImage;

            // 与页面保存规则一致：完全空白的角色不写入
            if (!name && !weaponName && !hasImage) {
                skipped++;
                continue;
            }

            usedIds.add(id);
            characters.push({
                id: id,
                name: name,
                avatar: await emitImage(rawCharacter.avatar, id, ctx),
                weaponName: weaponName,
                weaponImage: await emitImage(rawCharacter.weaponImage, id + '-weapon', ctx)
            });
            characterCount++;
        }

        output.versions.push({
            id: sanitize(rawVersion.id) || 'v_' + (output.versions.length + 1),
            name: String(rawVersion.name || '').trim(),
            characters: characters
        });
    }

    // 内容没变就沿用上次的 publishedAt，避免访客无意义地重绘、也避免空提交
    const previous = await readPrevious();
    if (previous && sameContent(previous, output)) {
        output.publishedAt = previous.publishedAt || output.publishedAt;
        log('   内容与上次发布一致');
    }

    if (!DRY_RUN) {
        await mkdir(path.dirname(DATA_FILE), { recursive: true });
        await mkdir(IMAGE_DIR, { recursive: true });
        await writeFile(DATA_FILE, JSON.stringify(output, null, 2) + '\n');
    }

    log('\n   ✅ ' + output.versions.length + ' 个版本 / ' + characterCount + ' 个角色' +
        (skipped ? '（跳过 ' + skipped + ' 个空白角色）' : ''));
    log('   🖼️  本次写入 ' + ctx.written + ' 张图片（' + kb(ctx.bytes) + '），' +
        '引用 ' + ctx.used.size + ' 张');

    if (PRUNE) {
        let files = [];
        try {
            files = await readdir(IMAGE_DIR);
        } catch {
            files = [];
        }
        const orphans = files.filter((name) => !ctx.used.has(name));
        for (const name of orphans) {
            if (!DRY_RUN) await unlink(path.join(IMAGE_DIR, name)).catch(() => {});
            log('   🧹 清理未引用图片：' + name);
        }
        if (!orphans.length) log('   🧹 没有需要清理的图片');
    }

    if (DRY_RUN) {
        log('\n   dry-run 结束，未写入任何文件。\n');
        return;
    }

    log('   📄 已生成 data/collection.json\n');

    if (!GIT) {
        log('   下一步：git add data assets && git commit -m "update collection" && git push\n');
        return;
    }

    execFileSync('git', ['add', 'data', 'assets'], { stdio: 'inherit' });

    const status = execFileSync('git', ['status', '--porcelain', '--', 'data', 'assets'], {
        encoding: 'utf8'
    });

    if (!status.trim()) {
        log('   ℹ️  没有内容变化，跳过提交与推送\n');
        return;
    }

    execFileSync('git', ['commit', '-m', 'chore: update collection data'], { stdio: 'inherit' });
    execFileSync('git', ['push'], { stdio: 'inherit' });
    log('\n   🚀 已推送，Cloudflare Pages 会自动部署，访客刷新后即可看到新内容\n');
}

main().catch((error) => {
    console.error('\n❌ 发布失败：', error && error.message ? error.message : error, '\n');
    process.exit(1);
});
