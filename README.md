# 明日方舟：终末地 · 抽卡资源统计与规划

纯静态网页工具，**双击 `index.html` 即可使用**，无需构建、无需安装依赖、无需本地服务器。

> 数据缓存在 IndexedDB。Chrome / Edge 在 `file://` 下会禁用 IndexedDB，
> 此时工具会自动退回内存缓存：功能正常，但刷新后数据会丢失。
> 需要长期保存数据时，请用任意静态服务器打开（Firefox 直接双击打开也支持）。
>
> 收集页的清单内容由站长发布到 `data/collection.json`，随站点一起部署；
> 只有「拥有状态」留在访客本机。发布流程见下文「发布收集清单」。

---

## 一、目录结构

```
index.html              抽卡规划页（资源统计、计算结果）
collection.html         角色 & 武器收集统计页（新页面）
css/
  base.css              设计令牌 + 深色/浅色主题 + 全局基础样式   ← 改配色只动这里
  layout.css            容器、头部、工具按钮、卡片、可收起模块、底部、响应式
  resources.css         抽卡资源统计区
  plan.css              抽卡规划弹窗内的版本卡片
  results.css           计算结果区（表格、设置列、汇总条）
  collection.css        收集统计页（统计卡、筛选、版本分组、行式清单、编辑弹窗）
  ui.css                按钮、通用弹窗、规划弹窗、设置弹窗、Toast
js/
  core/
    namespace.js        全局命名空间 ZMD（必须最先加载）
    util.js             数值解析、DOM 查询、事件绑定
    storage.js          IndexedDB 封装（Promise API，不可用时降级到内存，含旧数据迁移）
    store.js            抽卡规划状态中心：资源 / 版本列表 / 设置 + 变更标记（含字段名）+ 持久化
    calc.js             纯计算层：资源换算 + 抽卡推演 + 武库配额推演（不接触 DOM）
    collection-calc.js  收集统计纯计算层：角色拥有率 / 专武持有率 / 筛选
    collection-store.js 收集统计状态中心：内容与拥有状态分离 + 稳定 id + 发布文档
    collection-remote.js 读取线上发布内容（data/collection.json），失败静默降级
    image-util.js       图片裁切压缩（456×564 / 256×256，优先 WebP）
  ui/
    toast.js            轻提示
    theme.js            深色 / 浅色主题切换（两个页面共用）
    resources.js        资源统计区渲染、交互与「收起 / 展开」
    plan.js             版本列表渲染与编辑（事件委托）
    plan-modal.js       抽卡规划弹窗的打开 / 关闭
    results.js          结果表格、汇总、武库抽数列，以及结果表里的勾选设置
    settings-modal.js   默认抽数 + 武库配额获取开关
    page-actions.js     添加版本 / 重置 / 清除缓存
    collection.js       收集统计页渲染与交互（含只读模式）
    collection-publish.js 导出 / 导入发布草稿（仅编辑模式）
  renderer.js           抽卡规划页的界面刷新调度：按变更类型决定刷新哪些区域
  main.js               抽卡规划页启动入口
  collection-main.js    收集统计页启动入口（编辑 / 只读两种模式）
tools/
  publish-collection.mjs 发布脚本（零依赖）：草稿 → data/collection.json + 图片
data/
  collection.json       发布后的公共内容（脚本生成，提交仓库）
assets/
  collection/           发布后的角色头像 / 武器图片（脚本生成，提交仓库）
_headers                Cloudflare Pages 缓存策略
.assetsignore           Pages 上传时排除 tools / .verify
.verify/                校验脚本（开发自用，可整目录删除）
```

---

### 为什么用「经典脚本 + 命名空间」而不是 ES Module

`file://` 协议下浏览器会以 CORS 规则拦截 `type="module"` 的加载，
而本工具的使用方式就是双击打开。因此所有脚本都是经典脚本，按依赖顺序在
`index.html` / `collection.html` 末尾引入；模块之间通过全局对象 `ZMD` 通信。

同理，`file://` 下部分浏览器的 IndexedDB 不可用，缓存层会自动降级到内存，
并在控制台给出提示，不会因此报错或白屏。

---

## 二、界面分工（改版后）

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 抽卡资源统计 | 主页面 | 可整块收起 / 展开，收起后仅保留标题栏（含总抽数徽标） |
| 抽卡规划 | 弹窗 | 由资源区标题栏的「📋 抽卡规划」按钮打开；版本名称、规模、抽数、角色名、版本收入都在这里 |
| 角色 & 武器收集统计 | `collection.html` | 由主页面右上角「📚 收集统计」进入；管理版本 / 角色 / 专武图片并统计拥有率 |
| 是否抽取 / 当日获取 / 上半卡池时间已过 / 抽取武器 | 计算结果表「设置」列 | 直接在表格里勾选，勾选结果立刻参与推演；抽取武器为**每个角色各自一个开关** |
| 武库抽数 | 计算结果表最后一列 | 武库配额的独立推演结果（不计入总抽数）；未开启功能时整列隐藏 |
| 默认抽数、武库配额获取开关、清除缓存 | 右上角「⚙️ 设置」/ 规划弹窗底部 | 设置弹窗只改默认值与功能开关，不影响已有版本 |

**计算结果表的列**（共 8 列，已移除「判断方式」以便在窄屏上一屏看全）：

| 列 | 内容 |
| --- | --- |
| 步骤 | 版本名（含规模）+ 上半 / 下半 |
| 角色 | 角色名 + 「当日获取」「抽武器」状态标签 |
| 设置 | 抽取 / 当日 / 上半卡池时间已过 / 抽取武器的勾选框 |
| 半场抽数 | 该半场提供的抽数 |
| 判断时总抽数 | 做 120 抽判断时的总抽数 |
| 结果 | ⏭️ 跳过 / ⏭️ 上半已过 / ✅ 足够 / ❌ 不足 / +收入 |
| 扣除后抽数 | 扣除本角色 120 抽之后的剩余；**列表最后一个干员**在「当日获取 + 资源足够」时已把本半场抽数计入（等于最终剩余，鼠标悬停有说明） |
| 武库抽数 | 武库配额的本行增减与当前累计（未开启功能时隐藏） |

> 「判断方式」原本用整句说明（例如「当日获取（不计入半场58抽）」「上半卡池时间已过，不计入抽数」），
> 文案长、列宽大，是表格必须横向滚动的主因。这些信息并未丢失：
> 判断结果由「结果」列的状态标签表达，特殊模式由角色名后的标签表达。

- 「收起 / 展开」状态属于界面偏好，和默认抽数、武库配额开关一起存在 `settings` 里
  （`resourcesCollapsed` / `arsenalPlanEnabled`），刷新后保持。
- 版本名称可留空，留空时结果表按「版本N（规模）」显示；填写后即用自定义名称。
- 「扣除后抽数」的最后一个干员特例（`calc.js` 的 `run()` 末尾，步骤上的
  `afterDeductWithHalf` 标记）：当日获取是「先扣 120、再加本半场抽数」，
  中间值对其它干员必须保持「未计入本半场」，因为下一步判断要以它为基准；
  而列表最后一个干员后面没有步骤，所以它直接把本半场抽数计入，等于最终剩余。
  非当日模式本来就是「先加半场、再扣 120」，扣除后抽数天然已含本半场，无需特例。

### 武库配额获取（可开关功能）

默认**关闭**，在右上角「⚙️ 设置」里打开后，结果表会多出「武库抽数」列：

| 事件 | 武库配额变化 | 触发条件 |
| --- | --- | --- |
| 卡池抽取收入 | **+8160**（= 4.1 抽） | 每个「实际抽取」的角色卡池加一次；双角色版本两个卡池都抽就加两次 |
| 武器抽取支出 | **−15840**（= 8 抽） | 在结果表「设置」列给角色勾选「抽取武器」；**每个角色各扣一次**，两个角色的武器可分别勾选 |

- 该列**不计入总抽数**，计算方式与「武库配额抽数」一致（1980 配额 = 1 抽，保留 1 位小数），
  数值在每行的「武库抽数」单元格里逐步展示（本行增减 + 当前累计）。
- 手填的武库配额作为**初始值**参与叠加；未勾选抽取、或勾选「上半卡池时间已过」的卡池不产生收入。
- 取消某角色的「抽取」时，只有**该角色**的「抽取武器」会自动取消（另一个角色不受影响）；
  不该角色抽取时其武器勾选置灰（没有抽卡就无武器可抽）。
- 关闭开关后整列隐藏，但已保存的武器勾选不会丢失，重新开启即恢复。

---

### 角色 & 武器收集统计页（`collection.html`）

页面分成「收集总览」和「收集清单」两块，数据与抽卡规划完全独立：

| 功能 | 说明 |
| --- | --- |
| 添加 / 编辑版本 | 点击「＋ 添加版本」打开弹窗填写版本名与角色信息。弹窗**只用于填写信息**，不在主页单独占一块；保存后主页才出现清单 |
| 一行一个角色 | 每个「角色 + 它的一把专武」占一整行，下一个角色在下一行；窄屏下角色与专武在同一个块内上下排列 |
| 上传图片 | 在弹窗内点击角色头像槽位（456×564）或武器槽位（256×256），支持 PNG / JPG / WebP / GIF / BMP；浏览器会**等比缩放 + 居中裁切**并优先压缩成 WebP，保存后写入本地缓存；发布时再拆成独立图片文件 |
| 拥有勾选 | 主页每行内直接勾选「拥有角色」与「拥有专武」，勾选后立即更新统计；名称、图片等静态信息通过行尾「✎」或版本标题「✎ 编辑」修改 |
| 编辑权限 | 本地 `file://` 打开或线上 `?edit=1` 为编辑模式；普通访客只读，看不到「添加版本 / 编辑 / 删除 / 导出」按钮，但可以勾选自己的拥有状态 |
| 角色拥有率 | 顶部大卡显示分数 `已拥有 / 全部` 与百分比（如 `4/6`、`66.7%`），每个版本标题栏也有各自的 `x/y · 百分比` |
| 专武持有率 | 统计范围**仅限已拥有角色**：分子 = 已拥有角色中拥有专武的人数，分母 = 已拥有角色数。未拥有角色的专武不会进入分子或分母 |
| 筛选 | 「全部角色 / 拥有角色 / 未拥有角色」，按钮上带实时数量；筛选状态会记住 |
| 删除 | 版本与角色都提供删除按钮，删除前有确认提示 |

口径提示：

- 百分比最多保留一位小数，整数不显示 `.0`（`100%`、`50%`、`66.7%`）。
- 未拥有角色也可以单独勾选「拥有专武」（例如先抽到武器），但它不计入专武持有率；
  总览下方的统计说明会注明「其中 N 把属于已拥有角色」。
- 弹窗内的修改先存在草稿里，**取消不会写入**；保存时才整体替换该版本的名称与角色列表，
  已有的拥有勾选会保留。
- 编辑时图片只写在本机浏览器缓存，发布时由脚本解码成独立文件随站点分发，
  不会上传到任何第三方服务器。
  图片压缩后的目标体积上限：头像约 180KB、武器约 90KB。图片在弹窗内只是预览，
  点「保存」才写入缓存；如果缓存写满，本次保存会整体撤销并保留弹窗，
  方便删掉部分图片后重试，避免出现「界面上有图、刷新后丢失」的假象。
- 收集统计使用独立缓存键 `arknights_endfield_collection_v1`；
  主页面「🗑️ 清除本地缓存」会同时清空它（确认框里有说明）。

---

### 发布收集清单（纯静态，无后端）

清单内容（版本、角色、专武、图片）由站长维护，随站点一起部署，**访客只读**；
「拥有状态」属于每个访客自己，只存在本机 IndexedDB。两者靠角色的稳定 `id` 对应：
远端内容整体替换时，按 id 把本地勾选搬回去。

一次发布 = 三步：

1. 打开 `collection.html` 改内容并保存（本地 `file://` 双击即为编辑模式）；
2. 点「📤 导出发布包」，浏览器下载 `collection-draft.json`；
3. 项目根目录执行 `npm run publish`。

脚本 `tools/publish-collection.mjs`（零依赖，Node 18+）会：

- 自动去「下载」目录找最新的 `collection-draft.json`（`--input <路径>` 可指定）；
- 把每张 data URL 解码成 `assets/collection/<角色id>-<内容哈希>.webp`；
- 生成 `data/collection.json`（**不含任何拥有状态**）；
- 删除不再被引用的旧图（`--prune`）；
- `git add data assets` → 有变更才 commit → `git push`（`--git`）。

Pages 接仓库后 push 即部署，访客刷新即可看到。

| 命令 | 作用 |
| --- | --- |
| `npm run publish` | 生成 + 清理 + 提交 + 推送 |
| `npm run publish:dry` | 只打印会发生什么，不写文件 |

编辑模式判定：本地 `file://` 打开、或线上加 `?edit=1` 视为编辑；其余只读
（没有编辑按钮，只能勾选拥有状态）。只读只是交互层限制：纯静态站点没有写接口，
访客改不到别人的数据。

首次发布注意：老数据没有 `id`，脚本会要求「先在收集页打开一次」完成迁移。
迁移出的 id 由「版本名 + 角色名」哈希得到，站长与访客各自迁移后是同一个 id，
所以升级后用户已有的勾选不会丢；一旦写进发布文档，后续改名也不会换 id。

缓存策略见 `_headers`：`data/collection.json` 每次协商（`max-age=0`），
图片文件名带内容哈希，因此可以 `immutable` 长期缓存。

---

## 三、架构约定

数据是单向流动的，各模块之间**不互相调用**：

```
用户操作 → ZMD.store（唯一数据源）→ 标记变更 → notify
        → ZMD.renderer 合并到同一渲染帧 → 决定刷新哪些区域
        → ui.resources / ui.plan / ui.results 各自渲染
```

- **`ZMD.calc` 是纯函数层**：只接收普通对象（版本列表、资源数量、设置），
  不读 DOM、不写 DOM。因此规则可以单独测试，也能被未来的新界面复用
  （例如导出报告、模拟器）。
- **变更标记区分「结构变化」与「字段变化」**：
  改输入框的值不会重建版本卡片 DOM，否则用户输入时会被打断（光标丢失）；
  只有切换规模 / 角色数 / 勾选状态时才重建卡片。
  **`store` 会记录具体变化的字段名**（`consumeChangedKeys()` 返回的 `fieldNames`），
  `renderer` 据此判断：字段属于 `store.STRUCTURAL_VERSION_FIELDS`
  （`scale` / `roleCount`）时必须重建卡片 —— 否则卡片上的徽标、「共N抽」、
  角色半场标签会停留在旧值（这是早期版本的一个实时刷新 bug）。
  结果表里的勾选（抽取 / 当日 / 上半卡池时间已过 / 抽取武器）写的是版本字段，
  因此属于「字段变化」：不会重建规划弹窗里的卡片，只重算并重绘结果表与资源区。
  「抽取武器」是**每角色**字段（`role1Weapon` / `role2Weapon`），
  取消某角色抽取时只联动关闭该角色对应的 `roleXWeapon` 与 `roleXDayOne`。
- **结果表是推演开关的唯一编辑入口**：`calc.run()` 产出的每个步骤都带
  `versionIndex / roleIndex / isHalf1 / hasHalf2` 以及原始勾选值
  （`pullRequested / dayOneRequested`），`results.js` 据此渲染勾选框并把
  变化写回 `store.updateVersionField()`，界面与数据始终单向对应。
- **武库配额推演复用同一份推演结果**：资源区的「武库配额抽数」与结果表最后一列
  都读取 `calc.run()` 返回的 `arsenal` 汇总（`gainPulls` / `costPulls` / `totalPulls`），
  因此两处永远一致；开关关闭时 `run()` 完全不做武库配额加减。
- **事件委托**：版本列表的编辑事件只绑定在容器上，重建卡片不会重复绑定，
  新增字段也无需新增绑定代码（结果表的勾选框同理）。
- **缓存层是异步的**：`ZMD.storage` 基于 IndexedDB，`readJSON / writeJSON / remove`
  返回 Promise 且**永不 reject**（失败返回 `null` / `false`），调用方无需包 try/catch。
  因此 `store.save/load`、`collectionStore.save/load` 也是异步的，
  页面要等 `load()` 完成后再挂载界面模块（见 `main.js` / `collection-main.js`）。
- **数据兼容**：缓存键名沿用旧版本
  （`arknights_endfield_planner_v2` / `arknights_endfield_settings_v1`），
  首次启动会把旧版 `localStorage` 里的 4 个键迁移进 IndexedDB，迁移成功后删除旧键；
  旧数据缺失的字段会在载入时自动补齐
  （例如新增的 `versionName`，以及旧版本卡片里的
  `role1Pull / role1DayOne / skipHalf1` —— 它们会自动变成结果表里的勾选状态）。
- **收集页的编辑与展示分离**：`collectionStore` 只服务 `collection.html`，
  `collectionCalc` 是纯函数层（拥有率 / 专武持有率 / 筛选），`imageUtil` 只负责
  把上传图片裁切成固定尺寸。收集页不依赖抽卡规划的 `store`，两边的缓存互不影响
  （主题偏好共享，清除缓存会一起清空）。
- **内容与拥有状态分离**：`versions[].characters[]` 在内存里仍同时装着公共内容与
  个人勾选（渲染层因此完全不用改），但落盘时拆成 `versions` 和 `owned` 两份，
  发布文档 `toPublishDoc()` 也会剥掉 `owned`。远端内容整体替换时，
  `applyRemote()` 先把本地勾选按 id 收集起来，再回填到新列表上，
  所以站长增删角色、访客升级都不会丢勾选。
- **id 是唯一关联键**：`normalizeCharacter()` 在旧数据缺 id 时用
  「版本名 + 角色名」哈希补齐，站长与访客各自迁移后得到同一个 id。
  `CHARACTER_FIELDS` 是可写字段白名单，不要把 `id` 加进去；
  编辑弹窗的 `cloneCharacter()` 必须把 id 一起复制，否则保存后勾选全部失效。
- **弹窗草稿只保存一次**：添加 / 编辑版本时，名称与图片先写入 UI 内部的 `draft`，
  取消直接丢弃；保存时才整体替换 `collectionStore` 里的版本并写入缓存。
  主页只负责展示清单与勾选，所以输入不会被重绘打断，也避免了空版本 / 半成品数据。
  如果保存时缓存写入失败（配额不足），会回滚到保存前的版本列表，并保留弹窗方便重试。

---

## 四、常用扩展方式

### 1. 调整配色 / 新增主题

所有颜色都是 `css/base.css` 里的令牌，`[data-theme='dark']` 与 `[data-theme='light']`
两套值**一一对应**（新增令牌时请两边都补上，否则浅色主题下会取到空值）。

```css
:root[data-theme='mytheme'] {
    --bg: ...;
    --bg-card: ...;
    /* 复制整套变量并改值即可 */
}
```

若要让某个颜色随主题变化，不要写死颜色，改为引用令牌。

### 2. 修改抽卡规则

数值都集中在 `js/core/calc.js` 的 `RATES` 里：

```js
var RATES = {
    crystalJadePerPull: 500,   // 嵌晶玉：多少数量 = 1 抽
    guaranteeQuotaPerPull: 25, // 保障配额
    sourceStoneFree: 29,       // 衍质源石免费额度
    sourceStonePulls: 75,
    sourceStonePerPull: 500,
    arsenalQuotaPerPull: 1980, // 武库配额（不计入总抽数）
    arsenalQuotaPerPoolPull: 8160,   // 每个被抽取的卡池提供的武库配额收入
    arsenalQuotaPerWeaponPull: 15840, // 每把武器（每个角色）抽取的武库配额支出
    pullsPerRole: 120,         // 每个角色需要多少抽
    firstHalfRatio: 0.55       // 双角色版本上半占比
};
```

### 3. 新增一个界面模块

1. 在 `js/ui/` 新建文件，实现并挂载：

   ```js
   (function (ZMD) {
       'use strict';
       function init() { /* 绑定事件 */ }
       function render() { /* 按 ZMD.store.getState() 渲染 */ }
       ZMD.ui.myFeature = { init: init, render: render };
   })(window.ZMD);
   ```

2. 在 `index.html` 末尾按依赖顺序加 `<script src="js/ui/my-feature.js"></script>`；
3. 在 `js/main.js` 的 `UI_MODULES` 数组里加入 `ZMD.ui.myFeature`；
4. 若它需要响应数据变化，在 `js/renderer.js` 的 `renderAll()` 里声明它何时刷新。

> 收集统计页是独立入口：如果新模块属于收集页，把脚本加到 `collection.html` 末尾，
> 并在 `js/collection-main.js` 的 `initModules()` 里调用它的 `init()`。

### 4. 新增一个状态字段

在 `js/core/store.js` 的 `state` 里加字段 → 写对应的读写方法（记得调用
`markChanged('哪个区域')` 和 `notify()`）→ 在 `renderer.js` 里决定它影响哪些区域。

新增**版本字段**时注意选择正确的变更类型（这决定了卡片会不会重建）：

```js
// 只影响结果表 / 资源区的普通字段（例如 status 之外的开关）
markChanged('fields', fieldName);   // fieldName 会被 renderer 用于结构判断

// 会改变卡片结构或卡片内多处文案的字段（例如新增一种「版本规模」）
// 1) 在 store.js 的 STRUCTURAL_VERSION_FIELDS 里登记字段名
// 2) 在 plan.js 的 NUMBER_FIELDS / 卡片模板里按需处理
markChanged('versions');
```

字段名会随 `consumeChangedKeys()` 返回（`changes.fieldNames`），
`renderer` 用它判断是否需要重建规划卡片。**忘记登记**的症状是：
结果表已经更新，但规划弹窗里的卡片停在旧状态。

---

## 五、主题（深色 / 浅色）

- 右上角「🌙 主题」按钮切换，选择会记在 IndexedDB（`arknights_endfield_theme_v1`），下次打开保持。
- 从未选择过时，跟随系统 `prefers-color-scheme`；默认值为深色（与原版观感一致）。
- 主题读取现在是异步的，因此 `index.html` 与 `collection.html` 顶部各有一小段**唯一的行内脚本**：
  先按系统偏好写好 `data-theme`，并给 `<html>` 加上 `theme-pending`（`visibility: hidden`），
  等 `js/ui/theme.js` 从 IndexedDB 读回真实主题后再移除这个类，避免浅色用户刷新时看到深色闪屏。
  内联脚本里还有 400ms 兜底，防止脚本异常导致内容一直不可见。
  两个页面共用同一个主题键，在任何一页切换主题，另一页刷新后同样生效。

---

## 六、自检脚本（可选）

需要 Node.js（`jsdom` 可用时才能跑界面自检）。都是只读校验，不会修改交付文件：

```bash
node .verify/diff-calc.js     # 用「改造前的原始算法」差分比对 20000 组随机场景，确认抽卡数值未变
node .verify/dom-test.js      # 用 jsdom 真实加载页面，模拟点击验证：收起/展开、规划弹窗、结果表列结构与勾选、名称修改、清除缓存
node .verify/arsenal-test.js  # 武库配额功能 + 结构字段实时刷新：开关、+8160 / 每把武器 -15840、卡片重建
node .verify/migrate-test.js  # 旧缓存兼容：版本级 pullWeapon 迁移为每个角色的武器勾选
node .verify/collection-test.js # 收集统计页：添加/编辑弹窗、一行一个角色、主页勾选、拥有率与专武持有率、筛选、图片、主题与入口
node .verify/publish-test.js  # 发布脚本：dry-run、图片落盘与哈希命名、幂等、--prune、缺 id 报错
node .verify/publish-data-test.js # 数据层：稳定 id、发布文档剥离拥有状态、远端覆盖后勾选保留、删角色不串位
node .verify/readonly-test.js # 只读模式：隐藏编辑入口、勾选仍可用、?edit=1 恢复编辑
node .verify/make-preview.js  # 生成预览页（.verify/preview-*.html），配合无头浏览器截图核对排版
```

> `dom-test.js` / `arsenal-test.js` / `migrate-test.js` / `collection-test.js` /
> `publish-data-test.js` / `readonly-test.js` 依赖 `jsdom`
> （`npm i -g jsdom` 或本地安装）。
> `.verify/image-test.html` 是图片裁切压缩的真实浏览器自检页（需要在浏览器里打开，
> 用无头浏览器截图查看结果），不属于必需文件。
> 预览页与 `.verify/` 整个目录都只是开发自用，可以随时删除。

---

## 七、数据说明

- 抽卡规划数据与收集页的「拥有状态」只保存在浏览器本地
  （IndexedDB 数据库 `arknights_endfield`，对象仓库 `cache`），不上传任何服务器。
- 收集页的「内容」（版本 / 角色 / 专武 / 图片）来自站点上的 `data/collection.json`，
  由站长随站点一起发布，所以所有访客看到的是同一份清单。
- 缓存键：
  - `arknights_endfield_planner_v2`：资源 + 抽卡规划；
  - `arknights_endfield_settings_v1`：默认抽数与界面开关；
  - `arknights_endfield_theme_v1`：深色 / 浅色主题（两个页面共享）；
  - `arknights_endfield_collection_v1`：收集统计的版本 / 角色 / 图片 / 拥有状态 / 筛选；
    落盘时把内容与 `owned` 映射分开存，远端内容更新时按角色 id 找回勾选。
- 角色与版本都有稳定 `id`：新数据用 UUID，旧数据用「版本名 + 角色名」哈希补齐。
  发布文档只保留 `id` 与内容字段，`owned / weaponOwned` 永远不会出现在线上文件里。
- 从旧版本升级时，上面 4 个键会从 `localStorage` 自动迁移进 IndexedDB，
  迁移成功后旧键被删除；若新库里已有同名数据，则以新库为准。
- 「🗑️ 清除本地缓存」会同时清空资源数据、版本规划、默认抽数、武库配额开关，
  以及收集统计里的版本、角色与图片。
- 每 5 秒自动保存一次，切换标签页与关闭页面时也会保存（两个页面各自保存自己的数据）；
  资源区「收起 / 展开」的状态属于偏好设置，切换时会立即写入。
- 收集统计页的图片在写入前会被压到固定尺寸并优先编码为 WebP。
  IndexedDB 的配额远大于 localStorage 的约 5MB，但并非无限：
  写入失败时页面会提示并回滚当次修改。
- 旧缓存可直接读取：缺失的新字段（`role1Weapon` / `role2Weapon`、`arsenalPlanEnabled`）
  会在载入时自动补默认值（`false`，即与开启新功能前完全一致）。
- 早期版本用过「版本级」`pullWeapon`（整个版本只有一个武器开关，且只在第一条角色行显示）。
  载入旧缓存时会自动迁移为每个角色的 `role1Weapon` / `role2Weapon`：
  规则是「该版本内实际抽取的角色都算抽武器」，因此老用户的选择不会丢失，
  旧字段随后被清理。迁移逻辑见 `store.migrateVersion()`，覆盖测试见 `.verify/migrate-test.js`。
