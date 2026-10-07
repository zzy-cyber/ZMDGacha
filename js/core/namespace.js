/**
 * 全局命名空间（必须最先加载）。
 *
 * 采用「经典脚本 + 单一命名空间」而非 ES Module，原因：
 *  1. 双击用 file:// 直接打开时不受模块 CORS 限制，无需启动本地服务器；
 *  2. 依赖顺序由 index.html 中的 script 顺序显式表达。
 *
 * 目录约定：
 *   core/  ZMD.util / ZMD.storage / ZMD.store / ZMD.calc   与界面无关的基础能力
 *   ui/    ZMD.ui.<名字>                                     每个界面区域一个模块，暴露 init()
 *
 * 新增功能模块的步骤：
 *   1. 在 js/ui/ 下新建文件，实现 { init: function () { ... } } 并挂到 ZMD.ui.xxx；
 *   2. 在 index.html 中按依赖顺序加 <script>；
 *   3. 在 js/main.js 的启动列表里加入 ZMD.ui.xxx.init()。
 */
window.ZMD = window.ZMD || {};
