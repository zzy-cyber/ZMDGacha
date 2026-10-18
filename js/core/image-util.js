/**
 * 图片上传预处理：把任意尺寸的图片裁切压缩成固定尺寸的 data URL。
 *
 * 为什么要在浏览器里重新编码：
 *  1. 图片以 data URL 形式随角色对象存进 IndexedDB，原图 base64 体积过大、读写都慢；
 *  2. 统一成 456×564（角色头像）/ 256×256（武器）后，卡片布局永远整齐；
 *  3. 优先输出 WebP，体积约为同画质 JPG 的一半；不支持时自动回退 JPG / PNG。
 *
 * 裁切规则：等比缩放后居中裁切（cover），不拉伸变形。
 */
(function (ZMD) {
    'use strict';

    var PRESETS = {
        avatar: {
            width: 456,
            height: 564,
            label: '角色头像',
            sizeText: '456×564',
            /** 目标体积上限（字节），超出后继续降低画质 */
            maxBytes: 180 * 1024
        },
        weapon: {
            width: 256,
            height: 256,
            label: '武器图片',
            sizeText: '256×256',
            maxBytes: 90 * 1024
        }
    };

    /** 允许的文件名后缀（部分系统给出的 MIME 为空，用后缀兜底） */
    var FILE_PATTERN = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
    var MIME_PATTERN = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;
    var MAX_FILE_BYTES = 15 * 1024 * 1024;
    var QUALITIES = [0.82, 0.7, 0.58, 0.45];

    function fail(message) {
        return Promise.reject(new Error(message));
    }

    /** 读取文件为 <img>。 */
    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            var url;
            try {
                url = URL.createObjectURL(file);
            } catch (e) {
                reject(new Error('当前浏览器无法读取该文件'));
                return;
            }

            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('图片解析失败，请换一张图片试试'));
            };
            img.src = url;
        });
    }

    /** 等比缩放 + 居中裁切，画满目标尺寸。 */
    function drawCover(ctx, img, width, height) {
        var sw = img.naturalWidth || img.width;
        var sh = img.naturalHeight || img.height;
        if (!sw || !sh) throw new Error('图片尺寸异常');

        var scale = Math.max(width / sw, height / sh);
        var dw = sw * scale;
        var dh = sh * scale;
        ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }

    /** 优先 WebP，不支持时回退 JPEG，再回退 PNG。 */
    function encode(canvas, quality) {
        var url = canvas.toDataURL('image/webp', quality);
        if (url.indexOf('data:image/webp') === 0) return url;

        url = canvas.toDataURL('image/jpeg', quality);
        if (url.indexOf('data:image/jpeg') === 0) return url;

        return canvas.toDataURL('image/png');
    }

    /** data URL 的大致字节数（base64 膨胀约 4/3）。 */
    function estimateBytes(dataUrl) {
        var comma = dataUrl.indexOf(',');
        var payload = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
        return Math.round(payload * 0.75);
    }

    /**
     * 处理用户选择的文件。
     * @param {File} file
     * @param {'avatar'|'weapon'} kind
     * @returns {Promise<{dataUrl: string, width: number, height: number, bytes: number}>}
     */
    function processFile(file, kind) {
        var preset = PRESETS[kind];
        if (!preset) return fail('未知的图片类型');
        if (!file) return fail('没有选择图片');

        var typeOk = MIME_PATTERN.test(file.type || '') || FILE_PATTERN.test(file.name || '');
        if (!typeOk) return fail('请上传 PNG / JPG / WebP 等图片文件');
        if (file.size > MAX_FILE_BYTES) return fail('图片文件超过 15MB，请先压缩后再上传');

        return loadImage(file).then(function (img) {
            var canvas = document.createElement('canvas');
            canvas.width = preset.width;
            canvas.height = preset.height;

            var ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('当前浏览器不支持图片处理');

            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

            drawCover(ctx, img, preset.width, preset.height);

            // 从高画质往下试，第一次满足体积上限就采用；都不满足则用最小的一份
            var best = '';
            for (var i = 0; i < QUALITIES.length; i += 1) {
                var dataUrl = encode(canvas, QUALITIES[i]);
                if (!best || estimateBytes(dataUrl) < estimateBytes(best)) best = dataUrl;
                if (estimateBytes(dataUrl) <= preset.maxBytes) {
                    best = dataUrl;
                    break;
                }
            }

            return {
                dataUrl: best,
                width: preset.width,
                height: preset.height,
                bytes: estimateBytes(best)
            };
        });
    }

    ZMD.imageUtil = {
        PRESETS: PRESETS,
        processFile: processFile,
        estimateBytes: estimateBytes
    };
})(window.ZMD);
