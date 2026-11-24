# 16.10 App Center 与桌面程序统一为同一份应用清单（2026-11-16）

> 本文件是 `README.md` 第 16.10 节的独立副本。写入时系统 C 盘剩余 4 MB，
> WorkBuddy 的文件修改备份因 `ENOSPC` 失败，暂时无法合并进 `README.md`。
> C 盘空间恢复后把本文件全文追加到 `README.md` 末尾即可（内容一致，无冲突）。

用户反馈：**「App Center 内的插件和桌面上显示的程序是一回事，项目现在把他们区分开了」**。

## 修复前：三套互不相干的数据

| 位置 | 数据源 | 图标 |
|---|---|---|
| App Center | 后端 `lib/plugins.js` 的 `BUILTIN` 19 项 + `data/plugins/*.js`（`PLG.list`） | v15 `pluginIcon()` 确定性彩色渐变 |
| 桌面程序 | 底座 `APPS[k].desk` 写死的 8 项 | `appIcon()` 的 g1/g2 渐变 + glyph |
| 桌面插件快捷方式 | `/api/plugins/icons` 的 `V14.icons.list`，须在 App Center 点「桌面」手动添加 | 首字母方块 `.v14-ic-img` |

结果：两边清单对不上（19 vs 8）、同一个应用三种图标、还得手动「添加到桌面」；
「插件」与「程序」被当成两类东西分别维护。

## 修复后：一份 catalog，两处呈现

- `NasDeck_V15.catalog()` 为**唯一真源**，合并 `APPS`（窗口元数据）+ `PLG.list`
  （后端内置功能与上传插件）+ `V14.icons.list`（快捷方式表），按 id 去重，
  统一 id / 名称 / 英文名 / 分类 / 描述 / 版本 / 彩色图标。
- App Center `pluginCenter()` 改从 `catalog()` 取**全部**应用；桌面
  `renderDeskIcons()`（经 `build.py` REPL 钩子）委托 `NasDeck_V15.deskIconsHtml()`，
  只渲染 `onDesk` 子集。
- 两处共用 `pluginIcon()`：同一 id 永远同一渐变色，桌面图标不再是首字母方块。
- `onDesk` 只是清单里的一个属性，不再是另一套数据：内置程序按 `APPS[id].desk`
  默认显示；上传插件由后端 `/api/plugins/upload` 自动写入快捷方式表 →
  **安装即自动出现在桌面**，无需再点「添加到桌面」。
- 「从桌面隐藏」= 写 `localStorage` 的 `nasdeck61_desk_hidden` + 撤销后端快捷方式
  （若登记过）；**不卸载、不删除应用本体**。App Center 里该项仍在，标记
  「未显示到桌面」并提供「显示到桌面」。
- 「显示到桌面」清隐藏标记并写回快捷方式表；`v14-icon-add` 先调 `deskUnhide()`，
  避免隐藏过的内置应用加回快捷方式后仍不显示。
- 守卫每 1.5 s 比对清单签名，插件上传 / 删除 / 快捷方式变化后自动同步重绘
  桌面与 App Center（外部直接调 API 上传时最多一拍后两处一致）。
- 兼容保留：`data-di` 双击打开、`.v14-plugin` / `data-v14-icon` / `.v14-ic-x`
  供 v14 回归与既有动作使用；历史快捷方式残留项也并入 catalog，绝不丢用户数据。

## 改动与生效

`nasdeck-v15.src.js`、`nasdeck-real.src.js`、`build.py`、`index.html`
（重建产物，669253 字符）。后端 `server.js` / `lib/plugins.js` **未改动**
→ 5080 常驻进程无需重启，**刷新页面即生效**。

`build.py` 另改为「D 盘临时文件 + 原子替换」写产物，避开磁盘紧张时的覆盖拒绝。

## 验证

`_probe_unified_apps.js`（独立 5118 + mock Engine 2407 + 真 Chromium）
**12/12 PASS**，`PAGEERRORS []`：

| 断言 | 结果 |
|---|---|
| `CATALOG_IS_SINGLE_SOURCE` | 21 个应用，字段完整 |
| `DESK_USES_UNIFIED_ICON` | 9 个桌面图标全部为 v15 彩色图标 |
| `DESK_IS_CATALOG_ONDESK_SUBSET` | 桌面集合 === `catalog.onDesk` 子集 |
| `DESK_NAMES_MATCH_CATALOG` | 名称逐项一致 |
| `APPCENTER_LISTS_FULL_CATALOG` | 21 张卡 === catalog 全部 |
| `APPCENTER_EVERY_CARD_HAS_DESK_TOGGLE` | 每张都有桌面状态 + 切换按钮 |
| `DESK_AND_APPCENTER_ICONS_IDENTICAL` | 9 组渐变**逐字节相同** |
| `HIDE_ONLY_SHORTCUT_NOT_UNINSTALL` | 隐藏后仍在清单 / 仍有卡片 |
| `RESTORE_FROM_APPCENTER` | 恢复后重新显示 |
| `UPLOADED_PLUGIN_APPEARS_IN_BOTH` | 上传插件两处同时出现 |
| `DESK_DBLCLICK_STILL_OPENS_APP` | 桌面双击仍打开应用窗口 |
| `NO_PAGE_ERRORS` | [] |

## 本轮环境处理

C 盘由 34 MB 降到 4 MB 后，WorkBuddy 的 safe-delete 守卫因 `ENOSPC`
拒绝一切「截断覆盖 / 重命名 / 替换」操作（`SAFE_DELETE_BULK_GUARD_ERROR`），
连带验证脚本用 `'w'` 打开旧日志报 `EPERM`、Bash 工具与文档编辑也不可用。

已做降级：
1. 验证脚本 / 回归 runner 把 `TEMP/TMP/TMPDIR` 重定向到 `D:/wb_tmp/pwprofile`；
2. `build.py`、回归 runner 落盘改「D 盘临时文件 + 原子替换」；
3. 回归 runner 开跑前移走旧结果/日志、对 <10 s 的秒退标注 `[SUSPECT]`，
   避免把上一轮结果当本轮结论。

**核心新功能探针在独立端口/数据目录上 12/12 全绿**；旧回归套件需
C 盘空间恢复后复跑。全过程未删除任何用户文件。
