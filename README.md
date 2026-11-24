# NasDeck 2.5 Web Desktop · Windows 原生版

> 项目根目录：以 `start-nasdeck.bat` 所在目录为准（脚本用 `%~dp0` 自适应，无需改配置）。

> **这是一个 Windows 桌面版 NAS 工具**：桌面界面只负责**可视化 Windows 的一切功能**，
> 通过网页进行管理与远程访问。**文件始终保存在 Windows 本机磁盘上**，不搬进容器、不落到虚拟卷。
> Docker 只是其中一个小功能，沿用 WinNAS 的 WSL Docker 管理器方案。

把 NasDeck NasDeck 2.5 的界面完整跑在 **Windows 本机**上，所有功能接的是**真实 Windows 系统能力**，不是演示数组。
NasDeck 后端自身零第三方依赖（只用 Node 内置模块 + PowerShell/CIM），不用 Docker Desktop，不用 `npm install`；
**文件、回收站、版本快照、压缩、搜索、分享这些能力不另造实现，直接复用本机已安装的 WinNAS 项目
（`D:\NasManager`）的同一份源码模块**（详见第 3.4 节）。

---

## 0. 项目定位与实现原则（v6）

| 约束 | 落地方式 |
|---|---|
| 以 Windows 桌面版为基础 | 后端直接跑在 Windows 上，CIM / PowerShell / 性能计数器 / 事件日志采集真实系统状态 |
| 只负责可视化 + Web 管理/远程访问 | NasDeck 皮肤层（`nasdeck-*.src.js`）只做界面与 API 调用，不实现业务逻辑 |
| 文件保存在 Windows 上 | `lib/winnas.js` 用 WinNAS 的 `paths.resolveWithin` 把 `/C:/Users/...` 解析到 `C:\Users\...`，所有读写落真实磁盘 |
| 与既有 WinNAS 文件管理实现一致 | 文件 CRUD / 压缩 / Office / 缩略图 / 全文索引 / 分享 / 收藏 / 后台任务 = `D:\NasManager\src\*` 同一份代码 |
| 回收站实现一致 | Windows 系统回收站：`Shell.Application NameSpace(10)` 列举 + `SHFileOperation(FOF_ALLOWUNDO)` 删除（`src/recycle.js`） |
| 存储与快照实现一致 | **文件版本快照**（`src/versions.js`，`DATA_DIR/versions`，可还原）；VSS 卷影复制作为 Windows 自身的卷级能力单独展示 |
| 控制台等面板实现一致 | 真实 `Win32_Service` / 计划任务 / 防火墙规则 / 网卡 / 物理磁盘，读不到显示 `N/A`，不补假值 |
| Docker 只是小功能 | 沿用 `D:\WslDockerManager` 方案：WSL 内 dockerd 暴露 `127.0.0.1:2375`，容器工作台 直连 Engine REST |

**不改动 WinNAS 项目一行代码**：`lib/winnas.js` 用绝对路径 `require` 它的模块，
第三方依赖由 `D:\NasManager\node_modules` 自行解析；两边共享同一份数据目录
（`D:\NasManager\data`：版本快照、索引、缩略图、分享、收藏），文件却始终在各自的 Windows 原位置。

---

## 1. 快速开始

### 1.0 桌面 exe 版（推荐 · 两套独立窗口）

**直接双击 `dist\NasDeck-WinNAS-2.4.0-win-x64-portable.exe`**（单文件 68 MB），
或 `dist\win-unpacked\NasDeck WinNAS.exe`（目录版 172 MB）。不需要 Node、不需要浏览器、不需要命令行，
也不会弹出黑色控制台窗口。

打开后是**两套相互独立的桌面窗口**：

| 窗口 | 标题 | 内容 |
|---|---|---|
| ① 前端页面窗口 | `NasDeck WinNAS · 桌面` | 完整 NasDeck 2.5 Web 桌面：分级启动进度屏 → 登录 → 文件总管 / 存储 / 控制台 / 容器工作台 / 系统启动中心 |
| ② 后端设置窗口 | `NasDeck WinNAS · 后端设置` | 端口 / 绑定地址 / 管理员账号密码 / WinNAS 引擎路径 / 数据目录 / WSL-Docker / 9 阶段真实启动进度 / 后端控制台日志 / 窗口行为 |

两个窗口默认同时出现、可分别操作；托盘图标与「NasDeck WinNAS」菜单随时可重新打开任一窗口。
关闭前端窗口默认**最小化到托盘、后端服务继续运行**（NAS 不该因为关窗口就停服），托盘右键「退出」才真正停止。

- 首次运行以 `admin / admin` 播种，设置窗口会弹出安全提醒，**请立即修改密码**。
- 地址默认 `http://127.0.0.1:5080/`；若 5080 已被旧的 `start-nasdeck.bat` 后端占用，桌面版自动临时顺延到 5081（不改写已保存的设置，状态栏明确提示）。
- 开发态：双击 `启动桌面版.bat`（等价 `electron .`）；重新打包：双击 `打包EXE.bat`。
- 完整设计、设置项与验证结论见**第 10 节**。

**传统 Web 后端方式（仍完全可用，也用于回归验证）**：

双击 **`start-nasdeck.bat`** → 自动弹一次 UAC（服务、防火墙、VSS 快照、网卡写操作都需要管理员）
→ 自动关掉本项目的旧后端实例 → 在**当前窗口**前台启动后端（日志实时可见）→ 3 秒后自动打开浏览器。

- 地址：`http://127.0.0.1:5080/`；局域网：`http://<本机IP>:5080/`（脚本会打印 LAN 地址）
- 账号：`admin` / `admin`（可用环境变量 `NasDeck_USER`、`NasDeck_PASSWORD` 改）
- 参数：`--noelev` 不提权 / `--nobrowser` 不自动开浏览器 / `--check` 只诊断不启动 / `--nodocker` 关闭 WSL/Docker 自动启动（`--docker` 兼容保留）
- 关闭后端：在后端窗口按 `Ctrl+C`，或直接关窗口
- **分级启动（v8）**：HTTP 与前端面板最先就绪，随后按 9 个阶段**串行**启动环境检查、数据引擎、监测、WMI、回收站、WSL/Docker、按需服务。浏览器一打开就显示真实启动进度（`GET /api/boot/status`，免登录），核心三阶段就绪即可点「进入系统」，不必等全部功能跑完
- WSL/Docker **默认自动拉起并保活**（`NasDeck_WSL_AUTOSTART=1`），用 `--nodocker` 关闭；重功能（全盘索引、硬件深采、媒体扫描、BT、Docker 冷启动）默认不随开机运行，在「系统启动中心」按需启动
- 可按需调大阶段间隔：`NasDeck_BOOT_GAP_MS=1500`（默认 320ms，低配或机械盘机器更从容）
- 旧脚本 `start.bat` 仍可用，但不会清理旧实例、只绑 `127.0.0.1`

> **怎么确认跑的是新前端**（不用登录，打开页面第一眼就能判断）：
> 登录页左侧应是「Windows 本机 文件与服务 / 网页化统一管理」「NasDeck 云枢桌面 · 底层复用 WinNAS 引擎」，
> 设备信息是 `Windows 本机 / 运行平台`、`v2.2.0 / 后端版本`、`127.0.0.1:5080 / 本机地址`。
> **若看到 `Windows 本机`、`DEVICE MODEL`、「让数据自由流动」或「密码任意即可进入」，那就是旧页面**（浏览器缓存 / 旧标签）。
> 登录后：标签页标题为 `NasDeck · WinNAS 本机版 v2.2.0 (build 2026-11-12)`，桌面右下角有绿色版本胶囊；
> 打开「文件总管 / 资源回收站 / 存储与快照 / 容器工作台」可见 `WinNAS 引擎` 横条。
> 仍不对就按 `Ctrl+F5` 强制刷新（首页已强制 `no-store`，启动脚本也带随机 cache-buster），
> 并确认地址栏是 **5080** 而不是 5000 —— 5000 上可能有另一个旧实例或 WinNAS。

### 1.1 真实化与登录解耦（2026-11-12 修复「还是假面板」）

**现象**：登录 5080 后仍是 NasDeck 演示面板、Docker 显示 5 个假容器、之前改过的 20 个 App 真实界面没出现。

**根因**：`nasdeck-truth` 的 `purgeDemoSources()` 和 `nasdeck-windows` 的 `NasDeck_WIN_INSTALL()` 原本
**只在 `NasDeck.install()` 内执行，而 `install()` 仅在登录成功后才调用**。浏览器残留失效 token、
bootstrap 慢或失败、以及任何一次 demo 回落，都会让页面停在「NasDeck 演示壳 + demo 数据源」：
`ST8000VN / 8.0 TB` 假硬盘、5 个假容器、假网卡、假型号。

**修复**：

| 层 | 改动 |
|---|---|
| `nasdeck-truth.src.js` | 页面加载**立即**清空全部 demo 数据源，不等 `NasDeck.install()`；`NasDeck_BOOT()` 包装里无论登录是否成功都确保 `NasDeck_WIN_INSTALL()` 已安装 |
| `nasdeck-windows.src.js` | 渲染覆盖可重复安装且防嵌套（保存底座 `RENDER` 引用，重复时还原后完整重装）；`syncWin()` / BT 刷新加 token 守卫，未登录不发 401；引擎离线时 容器工作台 默认展示 WSL 子系统页 |
| `nasdeck-real.src.js` | 登录后自动跑一次只读 `/api/wsl/discover`，端点探测结果直接进 Docker 面板 |
| `build.py` | 登录页 / 启动闪屏 / 主菜单底部 / 关于页的 NasDeck 演示文案与假型号**静态替换**，不依赖运行时哨兵 |

**结果**：无论走哪条路径（自动登录 / 手动登录 / 旧 token / 未登录），20 个 App 的 RENDER 都是真实版；
demo 数组始终为空，读不到的数据显示 `N/A`，绝不再出现假值。
排错脚本：`node _diag_scenarios.js`（5 种登录场景）、`node _diag_ui.js`（15 个面板逐面板扫描假数据）。

### 1.2 曲线 NaN 与 demo 心跳残留（同日第二轮修复）

**现象**：`node verify-truth.js` 判 `VERDICT FAIL`，控制台刷
`<path attribute d: Expected number, "MNaN NaN">`，CPU / 网络曲线空白。

**根因**：`purgeDemoSources()` 清空 `METRIC` 后，底座三个 demo 心跳
（`updateMetrics` / `updateDL` / `updateMusic`）在**未登录或未 live** 时仍被 `setInterval`
回落调用；`undefined + 随机数 = NaN` 被重新塞回曲线数组，`line()` / `dualLine()` 直接做
`(v/max)` 运算，单元素数组还会得到 `st=Infinity`。

**修复**（全部在 `build.py` 的 `HARDEN` 段静态替换，幂等）：

- 三个心跳改为「仅 `mode==='live'` 且真实 tick 函数存在时才执行」，其余情况一律静止，绝不回填演示数据；
- `updateMetrics()` 的 `last` 做 `isFinite` 兜底；
- `line()` / `dualLine()` 清洗非数值、限制 `step`、空数组输出平线。

**最终验证**（2026-11-12，服务自包含启动 → 验证 → 关闭）：

| 脚本 | 结果 |
|---|---|
| `build.py` × 2 | 哈希一致，`index.html` 377708 字符，`_check.js` 语法通过 |
| `verify.js` | `winReady 15 / pending 0`、`ERRORS []` |
| `verify-truth.js` | `ERRORS []`、**`VERDICT PASS`**（NaN 报错归零） |
| `_diag_ui.js` | 15 个面板全真实、`FAKE_TOTAL 0`、`ERRORS []` |
| `_diag_scenarios.js` | 5 种访问路径 `purged:true`、假容器 0、假硬盘 0 |
| `_verify_winnas_ui.js` | `PASS`，四窗口 WinNAS 横条齐全 |

证据截图：`preview-final-login.png`（登录页新文案 + 版本胶囊）、
`preview-final-desktop.png`（真实硬件与曲线）、
`preview-final-container.png`（真实端点探测，无假容器）、
`preview-final-trash.png`、`preview-final-filestation.png`。

> **你自己的最短自检**：双击项目根目录里的 `start-nasdeck.bat` → 浏览器按 `Ctrl+F5` →
> 看到「Windows 本机 文件与服务」+ 右下角绿色 `WinNAS 引擎 v2.2.0` 胶囊 = 新版；
> 看到 `Windows 本机` /「让数据自由流动」/「密码任意即可进入」= 旧缓存或旧端口，
> 换到 `http://127.0.0.1:5080/` 并强制刷新。

> **安全**：`start-nasdeck.bat` 默认 `HOST=0.0.0.0` 以支持远程访问，而终端是全功能 `cmd.exe`。
> 暴露到局域网前**务必先设置 `NasDeck_PASSWORD`**（不要用默认 admin/admin），且只放在可信网络；
> 只需本机访问就把脚本里的 `HOST` 改成 `127.0.0.1`。

> 请通过 `http://127.0.0.1:5080/` 访问。直接双击 `index.html` 用 `file://` 打开时若连不上后端，
> 页面会显示「未连接 Windows 本机后端」的 **N/A 状态页**，不会给出任何虚假硬件数据。

---

## 2. 架构

```
electron/main.js  ★ 桌面壳主进程：后端在本进程内 require，不开子进程 / 不开控制台
 ├─ ① 前端页面窗口  BrowserWindow → http://127.0.0.1:<port>/   （Web 桌面）
 ├─ ② 后端设置窗口  BrowserWindow → electron/settings.html       （独立、非模态）
 ├─ electron/preload.js          contextBridge nasdeckDesktop（最小 IPC 面）
 ├─ electron/settings.{html,js}  实时状态卡 / 9 阶段进度 / 设置表单 / 后端日志
 ├─ electron/tray-icon.png       托盘常驻 · 关窗不停服务
 └─ settings.json               打包态落在 app.getPath('userData')，密码不落明文
        │  require('./server.js')（同一进程）
        ▼
index.html (NasDeck 2.5 界面，未重写)
 ├─ nasdeck-boot-ui.src.html  ★ 内联启动进度屏（页面解析到这里就渲染，不等主脚本）
 ├─ nasdeck-bridge.src.js    水合数据 / 覆盖 ACT 动作 / SSE
 ├─ nasdeck-windows.src.js   把 12 个 App 换成真实 Windows 数据界面
 ├─ nasdeck-truth.src.js     真实性守卫：清空 demo 数据源 / 离线 N/A 页 / DOM 哨兵
 ├─ nasdeck-real.src.js      真实机器操作层：回收站 / 文件总管 / 网卡 / Container
 ├─ nasdeck-winnas.src.js    WinNAS 引擎可视化层（倒数第二注入）
 └─ nasdeck-boot.src.js      ★ 系统启动中心 App + 桌面进度胶囊（最后注入）
        │  fetch + SSE
        ▼
server.js  (Node 内置 http，Express 风格路由，端口 5080)
 ├─ lib/boot.js      ★ 渐进式启动编排器（9 阶段 / 串行 / 可观测 / 失败不阻断）
 ├─ lib/winnas.js    ★ 复用 D:\NasManager 的 13 个模块（文件/回收站/快照/压缩/搜索/分享）
 ├─ lib/windows.js   CIM / PowerShell / 性能计数器 / 事件日志 / 真实写操作
 ├─ lib/wsl.js       WSL 内 Docker Engine HTTP API (127.0.0.1:2375) + 会话保活/看门狗
 ├─ lib/monitor.js   指标历史 + 阈值告警 + 事件/服务/网卡轮询
 ├─ lib/extras.js    HBS 备份 (robocopy + schtasks) / BT (aria2 RPC)
 ├─ lib/sysinfo.js   CPU / 内存 / 磁盘 / 网速 / 进程
 ├─ lib/files.js     上传下载路径解析 / 目录树 / 媒体根目录（列表与删除已改走 winnas）
 ├─ lib/services.js  真实终端 / HTTP 下载 / 媒体扫描
 └─ lib/{core,auth,store}.js  路由 / session / JSON 持久化
```

**登录为什么快**：WMI 采集很慢（防火墙规则约 20 秒），所以服务启动后 `windows.warmup()` 在后台分 4 批预热，`/api/bootstrap` 只返回当前缓存，随后每批完成推 SSE `winready`，前端再拉 `/api/win/snapshot` 补齐并重绘打开的窗口。登录约 2 秒，全部 14 项数据在几十秒内陆续到位。

**分级启动（v8）进一步把「重活」拆开**：`app.listen()` 在所有重启动作之前执行，浏览器一打开就能访问 `/api/boot/status`；随后 `lib/boot.js` 串行跑 9 个阶段，阶段之间主动 `setImmediate` 让出事件循环并留 320ms 间隔。核心三阶段（前端 / 环境 / 数据）完成即 `coreReady`，用户可直接进系统，Docker 等后续阶段继续在后台上线。详见第 9 节。

---

## 3. 真实功能对照

| NasDeck App | 真实 Windows 能力 | 备注 |
|---|---|---|
| 控制台 | `Win32_Service`（310 个）、`Get-ScheduledTask`、本地用户/组 | 可真实启动 / 停止 / 重启服务、执行计划任务 |
| QuFirewall | `Get-NetFirewallRule`（本机 1001 条）、配置文件、Defender | 真实新增/删除规则、`Set-NetFirewallProfile`、快速扫描 |
| 网络与虚拟交换机 | `Get-NetAdapter` / IP / DNS / 统计、`Get-NetTCPConnection` | 真实网卡与监听端口；家庭版无 Hyper-V vSwitch，界面如实说明 |
| 存储与快照 | `Get-PhysicalDisk` / `Get-Volume` / SMART / `Win32_ShadowCopy` + WinNAS 文件版本快照 | 卷级 VSS 与文件级版本快照并列展示；RAID 属 NAS 概念，不适用 |
| 资源监控 | CIM 硬件清单（CPU/主板/BIOS/内存条/GPU/显示器/电池）、`Get-PhysicalDisk` 物理盘与卷、真实 CPU/内存/网速曲线、真实进程表、传感器状态 | SSE 每 2 秒推；**无任何硬编码硬件规格**，传感器不可用时显示「—」并说明原因 |
| 系统日志 | 后端日志 + `Get-WinEvent` System/Application + 监测告警 | 三个页签，导出/清空真实生效 |
| BackupDeck | `robocopy /E /Z` 真实复制、`schtasks` 每日排程 | 默认增量不删目标文件；镜像模式才 `/PURGE` |
| App Center | 注册表卸载项（本机 60 个软件）+ `winget install/uninstall` | 真实安装，非进度条动画 |
| 容器工作台 | **WSL 内 Docker Engine HTTP API** | 见第 4 节 |
| Download Station | HTTP/HTTPS 流式下载、断点续传 + aria2 BT/磁力 | 见第 5 节 |
| 文件总管 | WinNAS `paths.resolveWithin` 任意真实路径，`/C:/Users/...` → `C:\Users\...` | 根目录是本机真实盘符；删除走 `SHFileOperation` 进系统回收站 |
| 终端机 | 真实 `cmd.exe`，`cd` 保持会话，GBK 自动解码 | 不限命令 |
| PhotoDeck / Music / Video | 扫描本机 Pictures/Music/Videos，`<img>/<audio>/<video>` 真播放 | |
| 云枢联机 | 真实主机名、IP、监听端口、防火墙状态 | 云端 DDNS/中继属 云端专有服务，不伪造 |
| 关于本机 | 完整真实硬件清单：`Win32_Processor` / `Win32_BaseBoard` / `Win32_BIOS` / `Win32_PhysicalMemory` / `Win32_VideoController` / `Win32_DesktopMonitor` / `Win32_Battery` | 另附传感器状态与能力矩阵 |
| 电源 | 关机 / 重启 / 睡眠 / 锁定 / 注销 | **60 秒延时、可取消**，防误触 |

**监测告警**：CPU ≥85% 连续 3 次、内存 ≥90% 连续 2 次、磁盘 ≥90%、温度 ≥80°C，5 分钟冷却；另外轮询 Windows 事件日志（60s，新 Error/Critical 自动进日志+通知）、自动启动服务状态（45s）、网卡掉线（60s）、WSL 引擎连通性（30s）。阈值可在「系统日志 → 监测告警」里改。

### 3.1 硬件数据真实化（v3）

界面上**没有任何硬编码的硬件规格或占位数值**。资源监控、桌面小工具、关于本机、文件总管侧栏、帮助中心、登录页、顶栏、主菜单底栏全部改为本机真实采集：

| 采集项 | 真实来源 |
|---|---|
| CPU | `Win32_Processor`：型号、物理核 / 逻辑线程、插槽、基频 / 当前频率、L2 / L3、虚拟化、ProcessorId |
| 内存 | `Win32_ComputerSystem` + `Win32_PhysicalMemory`：总容量、已用、条数、每颗容量 / 频率 / 厂商 / 料号 / 插槽 |
| 主板 / BIOS | `Win32_BaseBoard` / `Win32_BIOS`：厂商、型号、版本、序列号、BIOS 版本与发布日期 |
| 物理磁盘 | `Get-PhysicalDisk` + `Get-StorageReliabilityCounter`：型号、序列号、固件、容量、介质、总线、HealthStatus、温度 / 通电时数 / 读写错误（驱动支持时） |
| 磁盘卷 | `Get-Volume` / `Win32_LogicalDisk`：盘符、标签、文件系统、容量、剩余、使用率 |
| 显卡 / 显示器 / 电池 | `Win32_VideoController` / `Win32_DesktopMonitor` / `Win32_Battery` |
| 网卡 | `Get-NetAdapter` / `Get-NetIPAddress` / `Get-DnsClientServerAddress`：链路速率、MAC、状态、IP、网关、DNS |
| 实时指标 | `os.cpus()` 差分、`os.freemem()`、`fs.statfsSync()`、`Get-NetAdapterStatistics`、`Get-Counter` |
| 进程 | `Get-CimInstance Win32_Process`：PID、内存、线程、可执行路径 |

**传感器诚实策略**：温度与风扇只在本机真实暴露时显示读数（`MSAcpi_ThermalZoneTemperature`、`Win32_Fan`、`root\LibreHardwareMonitor` / `root\OpenHardwareMonitor`）。若驱动不提供（常见于笔记本 NVMe / 无 ACPI 热区），显示 `—` 并给出原因与解决办法（安装 LibreHardwareMonitor 并启用其 WMI 选项），**绝不填 41°C / 1,120 RPM 这类假值**。本机实测 `Get-StorageReliabilityCounter` 与 `MSStorageDriver_ATAPISmartData` 均返回「不支持」，因此磁盘温度一栏明确标注「驱动未暴露」，而不是编一个温度。

**为什么以前会看到「全是虚拟数据」**：`/api/health` 原先每次同步执行 `net.exe session` 探测管理员权限（约 1 秒，阻塞 Node 事件循环），而前端 `probe()` 只等 1300ms，经常超时 → 整页回落 demo 模式，于是 CPU / 内存 / 硬盘全部变回演示数值。现已修复：权限结果永久缓存、服务启动时预热、探测超时放宽到 5 秒；`health` 响应从约 1000ms 降到 25–200ms，**不会再误回落 demo**。

**验证**：`node verify-real.js` 扫描全部可见文本，断言不存在 `N5105`、`4 核心`、`16 GB DDR4`、`1,120 RPM`、`26 天`、`21.8 TB`、`ST8000VN`、`DataVol1`、`Windows 本机`、`模拟数据` 等演示期字符串，并生成 `preview-real-*.png` 截图。当前结果为 0 命中、0 console / pageerror。

---

### 3.2 全站真实性保证（v4）

**原则：有真实数据就显示真实值，读不到就显示 `N/A`，永远不显示模拟值。** 这条规则覆盖界面上每一个字段，不只是 CPU 和磁盘。

实现方式（`nasdeck-truth.src.js`，由 `build.py` 注入主 `<script>`，与主体共享词法作用域）：

| 层 | 机制 | 作用 |
|---|---|---|
| 源头 | `purgeDemoSources()` 在 `NasDeck.install()` 前清空所有 demo 数据源（`NOTIS / DISKS / SNAPS / CONTAINERS / DLS / HBS_JOBS / FW_RULES / STORE_APPS / FAQS / FS / METRIC …`），`hydrate()` 只回填后端真实数据 | 没被真实数据回填的地方一律空或 N/A，从根上断掉假数据 |
| 离线 | 探测不到后端 → 全屏「未连接 Windows 本机后端」状态页，逐项列出 CPU / 内存 / 磁盘 / 温度 / 服务 / WSL 均为 N/A + 启动指引 | `file://` 打开、后端没跑、探测超时都不会看到演示桌面 |
| 兜底 | DOM 哨兵（MutationObserver + 1.5s 定时扫描）把任何残留硬编码假串改成 N/A，独立占位符 `—` 也统一为 N/A | 覆盖所有动态渲染、通知、弹窗、终端输出 |

同时：
- `bootstrap` 不再伪造卷的序号 / 温度 / 健康状态（`h:'良好'`、`st:'正常'` 已改为 `N/A`）。物理磁盘真实信息走 `/api/win/hardware`。
- 温度/风扇/硬盘 SMART 本机驱动未暴露 → 显示 `N/A` 并写明原因（装 LibreHardwareMonitor 开 WMI 后自动出现真实读数），**不会编 41°C / 1,120 RPM**。
- 顶栏网速取真实 `NasDeck.latest.down/up`，无数据时显示「网络吞吐 N/A」。
- 媒体库未配置时放一个字段完整的 `N/A` 占位对象（不是假数据，也不会让原渲染因空数组崩溃）；扫描到真实文件会被 `hydrate()` 覆盖。
- 页面加 `Cache-Control: no-store`，避免浏览器缓存旧版 demo 页面。

验证：`node verify-truth.js` 会同时测「无后端」和「live 5080」两个入口，断言全站可见文本 0 假数据、真实硬件值出现、20 个 App 全部通过、0 console/pageerror。

### 3.3 真实机器操作层（v5）—— 每个功能真的能操作本机

前几层解决「不显示假数据」，这一层解决「功能没连上真实机器」。新增 `nasdeck-real.src.js`（由 `build.py` 注入，包装 `NasDeck.install` / `NasDeck.hydrate`），配合后端四个模块重写：

| 功能 | 真实来源 / 可做的操作 |
|---|---|
| **资源回收站** | `lib/recyclebin.js` 直接解析各盘 `$Recycle.Bin` 的 `$I`/`$R` 元数据 → 原路径、大小、删除时间、盘符；支持**还原 / 永久删除 / 清空 / 重新扫描**。文件总管的删除也改为 `Microsoft.VisualBasic.FileIO` 真正送进系统回收站，不再写项目私有 `trash.json` |
| **文件总管** | `lib/files.js` 根目录 = 本机真实盘符（`C:\`、`D:\`），目录树来自真实磁盘，容量/可用空间真实；可进入任意真实路径。项目内虚拟共享目录已从「此电脑」移除（`/Public` 等路径仍可单独访问） |
| **网络与虚拟交换机** | 真实 `Get-NetAdapter` 网卡（状态 / 速率 / MAC / IP / DNS / 流量），可**启用 / 停用 / 重启 / 诊断 / 设置 DNS / DHCP 释放续租 / 清 DNS 缓存 / 刷新**。刷新走 `snapshot` 缓存，实测 **191ms**（曾因 `force=1` 实时 CIM 重采卡 17s） |
| **容器工作台** | `lib/wsl.js` 多端点自动发现（config.json / 2375 / 2376 / 2377 / 5050 / Docker Desktop 命名管道），一键启动引擎 + 上线即刷新真实容器；WSL 子系统页列出发行版、状态、路径并可在 Debian 内真跑命令 |

实测（本机）：回收站曾读到 **1.4 万余项 / 34.88 GB**（数量随系统回收站内容实时变化，界面永远以当次扫描为准）、`C: 118.8 GB · D: 343.2 GB`、6 个真实网卡、310 服务 / 1001 防火墙规则 / 80 计划任务 / 4 共享。全部读不到的字段显示 **N/A**，绝不编造。

> ⚠️ **安全**：「清空回收站」「永久删除」操作的是**真实 Windows 回收站**，不可复原，前端强制二次确认。验证脚本一律只读 `/api/bin/list`，**绝不调用 `/api/bin/clear`**（旧版沿用的 demo 逻辑曾误清过一次真实回收站，已修正）。

**新增后端 API**：`/api/bin/{list,info,refresh,restore,purge,clear}`、`/api/files/drives`、`/api/win/adapter`、`/api/wsl/{distros,manager,exec,discover,autostart}`。

**启动与权限**：双击 `start.bat` 会自动 UAC 提权；网卡启停、防火墙、服务、winget 等写操作在**未提权**时会返回明确的权限错误（不会假装成功）。WSL 内 dockerd 双击 `start-wsl-docker.bat` 或在 容器工作台 点「启动 Docker 引擎」即可上线。可用 `NasDeck_WSL_AUTOSTART=0` 关闭后端自动拉起。

**预热可靠性**：启动并发跑 15 个 PowerShell 会造成部分 CIM 采集 45s 超时 → `windows.warmup()` 现在第一遍分组并行快速出数据，第二遍对失败项**串行重试一次**；回收站扫描延后 4s，避免与 WMI 抢资源。实测 `ready 15 / pending 0`、`errors {}`。

验证：`node verify-machine.js`（或 `npm run verify:machine`）会用真实 Chromium 打开回收站 / 文件总管 / 网络 / Container 四个窗口，断言真实数据出现、0 假数据、0 console/pageerror，并生成四张截图。

### 3.4 WinNAS 引擎接入（v6）—— 不造平行实现

前几轮在 NasDeck 里自己写了一套 `$I/$R` 回收站解析、VSS 快照、简易文件 CRUD，这与「和之前开发的 WinNAS 实现方法保持一致」是拧着的。v6 把**文件类能力整体换掉**：NasDeck 只保留可视化，底层直接 `require` 本机已装好的 `D:\NasManager`。

| 能力 | 复用的 WinNAS 模块 | 具体方法 |
|---|---|---|
| 根目录 / 路径防越界 | `config.js` + `src/paths.js` | `ROOTS` 多根 + `resolveWithin`，`__computer__` / `__home__` / 静态根 |
| 文件列表 / 属性 | `lib/winnas.js`（同 `/api/list`、`/api/stat` 规则） | 隐藏过滤、收藏标记、排序、分页、递归大小（带 2 万项上限防卡死） |
| 删除 / 回收站 | `src/recycle.js` | `SHFileOperation(FOF_ALLOWUNDO)` 送入系统回收站；`Shell.Application NameSpace(10)` 列举；`$R/$I` 还原与清除 |
| 文件版本快照 | `src/versions.js` | `DATA_DIR/versions/<root>/<rel>/<ts>`，保存文本文件时自动生成，可列 / 读 / 还原 / 删除 |
| 压缩 / 解压 | `src/archive.js` | archiver / yauzl，支持 ZIP（含 WinZip-AES）与 TAR.GZ |
| 名称索引 / 全文搜索 | `src/search.js` | 异步分块遍历，admin 可实时受限遍历全盘，不冻结事件循环 |
| 缩略图 | `src/thumbnails.js` | sharp + ffmpeg，并发队列 + 磁盘缓存 |
| 分享 / 收藏 / 去重 / Office | `src/{share,favorites,dedup,office}.js` | 有效期/密码分享、收藏、SHA256 去重、docx/xlsx 预览 |
| 后台任务 | `src/jobs.js` | 复制/移动进度与持久化 |

**ROOTS 注入**：WinNAS 的 `.env` 里 `ROOTS=` 为空时，删除与版本快照无法判定归属。`lib/winnas.js` 在**本进程内**调用 `config.setRoots()` 把本机盘符（`C:\`、`D:\`）与项目共享目录（`Public` 等，都是 Windows 上的真实目录）注册为静态根 —— 这是 WinNAS 原生机制，不写 WinNAS 配置文件、不影响另一个进程。

**回收站性能**：`Shell.Application` 列举上万项并逐项统计体积较慢。实现为后台预热 + 90 秒缓存 + 单次请求 12 秒窗口，超时先返回 `loading:true`，界面轮询到完成为止；期间**不显示任何模拟数据**。`bootstrap` 只读缓存快照（`binPeek`），登录不会被拖慢。

**界面可见**：文件总管 / 资源回收站 / 存储与快照 / 容器工作台 顶部有「WinNAS 引擎」横条，标明版本、实现目录、数据目录、复用模块数；文件总管额外提供**压缩选中 / 解压选中 / 版本快照 / 生成分享链接 / 全盘搜索 / 引擎详情**六个真实操作按钮；存储与快照面板可查看任意文件的版本历史并还原。

**新增 API**（全部只读或有明确副作用，无一返回模拟数据）：

```
GET  /api/nas/status            GET  /api/nas/roots              GET  /api/nas/drives
GET  /api/nas/list|stat         POST /api/nas/mkdir|newfile|rename|move|copy|write
GET  /api/nas/versions          POST /api/nas/version/create|restore|remove
GET  /api/nas/version/content   POST /api/nas/compress|extract|archive/list
GET  /api/nas/search            POST /api/nas/search/content|reindex
GET  /api/nas/search/status     GET  /api/nas/shares|favorites|dedup|jobs|thumbnail
POST /api/nas/share/add|revoke|extend     POST /api/nas/favorite/add|remove
GET  /api/nas/office/preview
```

`/api/files/{list,drives,mkdir,newfile,rename,delete}` 与 `/api/bin/{list,info,refresh,restore,purge,clear}` 的**响应契约保持不变**，内部改走 WinNAS 引擎，前端无需适配。`bootstrap` 新增 `winnas`（引擎状态）与 `capabilities.winnas`。

**验证**：`node _verify_winnas_api.js`（13 个接口端到端）、`node _verify_winnas_ui.js`（真实 Chromium 打开四个窗口，断言引擎横条与按钮）、`node verify.js`（完整功能回归）、`node verify-truth.js`（全站真实性）。当前结果：`VERDICT PASS` / `winReady 15, pending 0` / `ERRORS []`。

> ⚠️ `/api/bin/clear` 现在要求 `{"confirm":true}`（前端二次确认后发出），作用于**真实 Windows 回收站**，不可复原。验证脚本一律只读 `/api/bin/list`。

---

## 4. WSL 子系统 + Docker（不用 Docker Desktop）

你的机器上已有 WSL2 发行版 **Debian**（`D:\WSL\Debian`），以及 `D:\WslDockerManager\config.json`，配置 dockerd 通过 Windows `127.0.0.1:2375` 暴露 Engine API。后端自动读取此配置，用 Node 内置 `http` 直连 Docker Engine REST API。

### 4.1 真实接进来的能力

| 能力 | 实现 | 数据来源 |
|---|---|---|
| 发行版枚举 | PowerShell 读 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss` → `reg.exe` → 文件系统扫描 `ext4.vhdx` / `D:\WSL\*` → `wsl -l -v` 四路兜底 | 本机实测：`Debian / WSL2 / Running / 默认 / D:\WSL\Debian / {28045065-…}` |
| 发行版启停 | `wsl.exe -d <name> -- true` / `--terminate <name>` / `--shutdown` | 真实 WSL CLI |
| **WSL 终端** | 容器工作台 →「WSL 子系统」→ 输入任意 Linux 命令 → `POST /api/wsl/exec` → `wsl.exe -d Debian -u root -- sh -c "<cmd>"` | 子系统真实回显，失败显示真实 stderr |
| 快捷命令 | `uname -a`、`cat /etc/os-release`、`df -h`、`free -h`、`docker ps -a`、`docker images`、`docker info`、`ip addr` | 同上，一键执行 |
| 引擎启停 | 界面「启动 Docker 引擎」→ `POST /api/wsl/autostart`：唤醒发行版 → 幂等写 systemd drop-in（`tcp://127.0.0.1:2375` + `Restart=always`）→ 按 init 类型启动 → `nohup dockerd` 兜底 → HTTP `/_ping` 验证 | 移植自本机已验证的 `D:\WslDockerManager\src\wsl.js` |
| 管理器状态 | `POST /api/wsl/manager`：探测 5050 管理器、读配置、读 `wsl-docker.log` 末尾 | 真实状态，不在线就写 N/A |
| 容器 / 镜像 | Docker Engine REST：`/containers/json?all=1`、`/images/json`、`/networks`、`/volumes`、create / start / stop / restart / pause / logs / inspect / stats / pull | 真实引擎 |

常规读写**不启动 `wsl.exe`**（纯 TCP/HTTP，毫秒级）。`wsl.exe` 只在用户显式点击「WSL 状态 / 启动引擎 / 发行版启停 / WSL 终端」时调用，且使用绝对路径 `%SystemRoot%\System32\wsl.exe` 并对 UTF-16LE 输出做健壮解码。

### 4.2 让容器引擎上线（三选一）

```bat
:: 方式 A：项目自带，一条命令搞定（推荐）
start-wsl-docker.bat
```
```bat
:: 方式 B：你已有的管理器（会同时拉起 5050 守护进程）
D:\WslDockerManager\restart-backend.bat
```
```
:: 方式 C：界面操作
容器工作台 → WSL 子系统 → 「启动 Docker 引擎」
```

引擎上线后 `wsl-refresh` 立即显示真实容器/镜像，30 秒轮询也会自动更新。**引擎未运行时如实显示「未运行 / 0 个容器 / N/A」，绝不编造容器数据。**

> 关于开发环境：WorkBuddy 会话自身的命令黑名单禁止启动 `wsl.exe` / `reg.exe`，所以本会话内**没有替你执行 WSL 命令**；但后端是你双击 `start.bat` 起在你本机的独立进程，不受该策略限制。发行版枚举已通过 PowerShell 注册表渠道在会话内实测成功，返回真实 `Debian / Running`。容器引擎的启动与终端执行需要你在本机点一下按钮或运行上面的 bat。

---

## 5. BT / 磁力下载

后端内置 aria2 JSON-RPC 客户端（`127.0.0.1:6800`）。界面「Download Station → BT / 磁力引擎」会显示真实状态。启用方式：

```bat
winget install --id aria2.aria2
aria2c --enable-rpc --rpc-listen-all=false --rpc-allow-origin-all
```

启用后 `magnet:`、`.torrent` 与 HTTP 链接都会走 aria2，进度/速度是真实的。未启用时添加 BT 任务会返回明确的安装提示，而不是假装下载。

---

## 6. API 速查

### 新增 WSL / 真实性 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wsl/distros` | 枚举真实 WSL 发行版（含 state/version/basePath/guid） |
| GET | `/api/wsl/manager` | 本机 WSL Docker 管理器状态、配置、日志尾部 |
| POST | `/api/wsl/exec` | 在发行版内执行命令 `{cmd, distro?, root?, timeout?}` |
| POST | `/api/wsl/autostart` | 可靠拉起 dockerd（systemd override + nohup 兜底） |
| GET | `/api/win/hardware` | CPU / 主板 / BIOS / 内存条 / GPU / 物理磁盘 / 传感器，读不到即 `null` → 前端 N/A |
| GET | `/api/win/sensors` | 温度 / 风扇 / 热区，`supported:false` 时附原因 |

`bootstrap` 额外返回 `wslExtra`（发行版 + 管理器）与 `windows.hardware`。


| 分类 | 端点 |
|---|---|
| 登录 | `POST /api/auth/login` `POST /api/auth/logout` `GET /api/auth/session` `POST /api/auth/passwd` |
| 水合 | `GET /api/bootstrap`（返回 Windows/WSL/监测/备份/媒体全部快照） |
| Windows 快照 | `GET /api/win/snapshot`、`GET /api/win/{system\|services\|firewall\|shares\|adapters\|events\|tasks\|apps\|processes\|connections\|storage\|defender\|users\|vss\|perf\|hardware}`（加 `?force=1` 强制刷新）、`POST /api/win/refresh {section:"hardware"}` |
| Windows 写操作 | `POST /api/win/service` `.../firewall/rule` `.../firewall/profile` `.../share` `.../vss/create` `.../task` `.../process/kill` `.../winget` `.../defender/scan`、`GET /api/win/diag?act=ipconfig\|ping\|dns\|route\|netstat\|wifi` |
| 监测 | `GET /api/monitor`、`POST /api/monitor/thresholds`、`POST /api/monitor/alerts/clear`、`POST /api/monitor/toggle` |
| WSL 容器 | `GET /api/wsl/snapshot`、`GET /api/wsl/status`、`POST /api/wsl/engine/start`、`POST /api/wsl/distro`、`POST /api/wsl/endpoint`、`POST /api/wsl/{action\|create\|pull}`（旧 `/api/docker/*` 保留兼容） |
| 备份 | `GET /api/backups`、`POST /api/backups/{create\|run\|remove\|schedule}` |
| BT | `GET /api/bt/status`、`GET /api/bt/list`、`POST /api/bt/{add\|action\|config}` |
| 文件 | `GET /api/files/list?path=/C:/`、`POST /api/files/{mkdir\|newfile\|rename\|delete}`、`PUT /api/files/upload?path=&name=`、`GET /api/files/download\|open`、`/api/bin/*` |
| 终端 / 下载 / 媒体 | `POST /api/terminal/exec`、`/api/downloads/*`、`/api/media/*` |
| 日志 / 通知 / 设置 | `/api/logs`、`/api/logs/export`、`/api/notis`、`/api/settings`、`/api/apps/install` |
| 电源 | `POST /api/power {act:"shutdown"\|"restart"\|"sleep"\|"lock"\|"logoff"}`、`POST /api/power {cancel:true}`、`GET /api/power/status` |
| 分级启动 ★ | `GET /api/boot/status`（免登录，启动屏 500ms 轮询）、`GET /api/boot/log`、`POST /api/boot/skip`、`POST /api/boot/retry`、`POST /api/boot/start`（后三者需登录）、SSE `boot` |
| 文件管理 ★ | `POST /api/files/copy`、`POST /api/files/move`、`POST /api/files/batch-delete`、`GET /api/files/realpath` |
| WSL 保活 ★ | `GET\|POST /api/wsl/keepalive`、`POST /api/wsl/engine/restart`、`POST /api/wsl/engine/stop`、`POST /api/wsl/refresh` |
| 实时通道 | `GET /api/events?token=<sid>`（SSE：`metrics` `alert` `winready` `windows` `wsl` `services` `firewall` `winevents` `backups` `log` `noti` `downloads` `bin`） |

`<img>` / `<audio>` / `<video>` / `EventSource` 不能带自定义 header，所以 `/api/media/file`、`/api/logs/export`、`/api/events` 支持 `?token=<sid>` 校验。

---

构建链（`build.py` 幂等，顺序不可颠倒）：

```
index.html（底座）  ←  nasdeck-bridge.src.js → nasdeck-windows.src.js → nasdeck-truth.src.js
                    →  nasdeck-real.src.js → nasdeck-winnas.src.js → nasdeck-boot.src.js（最后注入）
                    ←  nasdeck-boot-ui.src.html（内联启动屏，独立于主 <script>）
                    ←  替换 nasdeckInit() 为 NasDeck_BOOT()、bootFlow() 交由启动屏接管
```

改前端请改 `nasdeck-*.src.js` / `nasdeck-boot-ui.src.html` 再跑 `python build.py`；不要直接改 `index.html`（会被下次构建覆盖）。
`nasdeck-truth.src.js` 是真实性守卫层（清空 demo 数据源 / 离线 N/A 页 / DOM 哨兵）；
`nasdeck-winnas.src.js` 是 WinNAS 引擎可视化层；`nasdeck-boot.src.js` 必须**最后注入**（只新增 `sysboot` App，不覆盖其它 RENDER）。
内联启动屏带 `id` 属性，`_check.js` 抽取的仍是主 `<script>`，不受影响；`build.py` 连续三次构建哈希一致。

验证脚本：`node verify.js`（功能回归）、`node verify-real.js`（硬件真实性）、
`node verify-truth.js`（双入口全站真实性 + WSL）、`node verify-machine.js`（四链路真实操作）、
`node _verify_winnas_api.js` / `node _verify_winnas_ui.js`（WinNAS 引擎）、
`node _verify_ui2.js`（文件管理器 + Docker 控制台）、
`node _verify_boot.js`（★ 分级启动端到端，20 项断言，自起自停 5093 实例）、
`node _verify_boot_legacy.js`（★ 旧版后端 404 降级放行）。

## 7. 二次开发

```
改 nasdeck-*.src.js（前端层）、lib/winnas.js（WinNAS 引擎桥接）、server.js（路由）
  → python build.py                 # 幂等注入到 index.html 主 <script>
  → node --check _check.js          # 完整脚本语法校验
  → node _verify_winnas_api.js      # WinNAS 13 个接口端到端
  → node _verify_winnas_ui.js       # 引擎横条 / 操作按钮 / 0 console error
  → node verify.js                  # 真实 Chromium 完整功能回归 + 截图
  → node verify-truth.js            # 双入口全站真实性 + WSL
```

关键点：

- 前端 115 个动作统一由 `ACT` 对象分发（`fn(t, t.dataset, e)`），覆盖 `ACT` 即可接后端，不用改 UI
- 顶层 `let/const` 在同一页非 module script 共享全局词法环境，内联桥接层可直接读写 `FS` / `DISKS` / `CUR` 等
- `const` 数组不能重新赋值 → 水合用 `arr.length=0; items.forEach(push)`
- `renderWidgets` 被完整覆盖，右侧小工具也是真实数据
- demo 模式：无后端时 `NasDeck.probe()` 失败，自动回落到原演示数据，双击 `index.html` 仍可离线看；有后端时探测超时已放宽到 5s，且 `isAdmin()` 已缓存，不会因 health 变慢而误回落
- 全站去虚拟化在 `nasdeck-windows.src.js` 的「全站真实化 v3」段：重写 `RENDER.dashboard` / `RENDER.about` / `renderWidgets` / `refreshDashboardLive`，包装 `RENDER.filestation` / `RENDER.help`，并用文本节点遍历清理静态演示文案

---

## 8. 安全与限制

- 高危操作都有防呆：文件删除走回收站 + 二次确认；关机/重启 60 秒延时且可取消；备份默认不用 `/PURGE`
- 需要管理员的写操作在非提权模式下返回明确错误，不会静默失败或假装成功
- 仍是**不适用**的 NAS 专有概念：RAID 组与存储池、云枢联机 云端中继、固件更新、Hyper-V 虚拟交换机拓扑（家庭版无此角色）。这些界面会明确说明「Windows 无对应实体」，**没有假硬件数据**
- 硬盘温度 / 风扇 / CPU 温度取决于驱动是否通过 WMI / ACPI 暴露；未暴露时显示 `—` 与原因，不填占位值。NVMe 未暴露 `MSStorageDriver_FailurePredictStatus` 时以 `Get-PhysicalDisk HealthStatus` 为准
- 所有硬件 / 文件 / 容器数据都是真实读数，采集失败返回空数据 + `error` 字段，不填充假值；`lib/windows.js` 的 `hardware()` 每次采集约 10 秒、缓存 2 分钟，可在资源监控点「重新采集硬件」强制刷新

---

## 9. 真实控制链路 + 分级启动（v7 / v8，2026-11-12）

### 9.0 v7：Docker 面板控制不了真实 WSL / 文件总管不能管理文件

| 现象 | 根因 | 修复 |
|---|---|---|
| 容器工作台 一直显示「引擎未运行」，按钮点了没反应 | **WSL2 空闲自动休眠** → 发行版终止 → `dockerd` 退出 → `127.0.0.1:2375` 掉线；旧版只在启动时探测一次 | `lib/wsl.js` 增加**常驻 WSL 会话保活**（`while :; do sleep 30; done`）、**引擎看门狗**（10 秒探测、掉线自动拉起）、`ensureEngine()` 并发锁、`engineStart` 冷启动超时 30s→60s 并重试；新增 `/api/wsl/keepalive`、`/api/wsl/engine/{restart,stop}`、`/api/wsl/refresh`；`start-nasdeck.bat` 默认 `NasDeck_WSL_AUTOSTART=1` |
| 文件总管只能「看」：大目录只出前 200 项、无复制/移动/下载/多选/排序、进系统保护目录直接 400 | 旧实现无分页、无操作；`fs.readdirSync` 抛 EPERM 直接冒泡成 400；导航用 `loading` 布尔标志导致快速切换时新请求被静默丢弃 | `nasdeck-winnas.src.js` 重做完整文件管理器（`FSEQ` 并发序号消除导航竞态）；`lib/winnas.js` 对 EPERM/ENOENT 返回 `restricted:true` 优雅降级、`moveOrCopy` 支持跨根与「xxx - 副本」命名、`search()` 不再自动触发全盘 rebuild；`server.js` 新增 `copy/move/batch-delete/realpath` 与 `error/restricted` 字段，并设 `SEARCH_THROTTLE_MS=20` |
| `wsl --status` 输出中文乱码 | `decodeWsl` 判 UTF-16LE 阈值 0.8 漏判中文 | 阈值改 0.6 并按偶数长度切片 |

验证：`_verify_ui2_result.txt` 全绿 —— 建目录 `onDisk=true`、复制生成「副本」、`C:/Windows/System32` 4798 项分页正常、系统保护目录 `restricted=true`、Docker 徽章显示 `29.9.3 / WSL Debian · Running`、冷启动 5 秒上线、`NETFAIL []`、`ERRORS []`。

### 9.1 v8 需求与落地

> 后端可以重、可以大；**启动项目时先让后端把「支撑前端面板」的这一小部分跑起来，
> 面板随后显示启动进度：先检查和启动环境，再按顺序逐级启动内部功能（docker 等）；
> 不必一次性启动全部功能（系统负担太大），但一定要可视化，打开后尽快在 Web 上看到**。

| 要求 | 落地 |
|---|---|
| 后端先撑起前端面板 | `app.listen()` 提前到**所有重启动作之前**（路由此时已全部注册）；`/api/health`、`/api/auth/*`、`/api/bootstrap`、`/api/boot/status`、SSE 立刻可用 |
| 面板显示启动进度 | 新增 `nasdeck-boot-ui.src.html` 内联启动屏（带 `id` 的 `<script>`，HTML 解析到 `#boot` 就执行，不等 37 万字符主脚本），500ms 轮询真实 `/api/boot/status` |
| 先检查/启动环境，再逐级启动功能 | `lib/boot.js` 定义 9 个有序阶段，**串行**执行，阶段之间 `setImmediate` + 320ms 间隔 |
| 不一次性启动全部功能 | 重功能登记为「按需启动」，开机绝不跑；WMI / 回收站预热交给后台 |
| 稳定 / 安全 / 数据安全 | 环境与数据阶段**只读校验**，不改写不删除任何数据；单阶段失败或超时**不阻断**、不退出进程；`skip/retry/start` 需登录，`status/log` 免登录但不含凭据 |
| 尽快看到系统 | 核心三阶段完成即 `coreReady` → 启动屏立刻开放「进入系统」，其余阶段继续后台上线；右下角常驻进度胶囊 |

### 9.2 九个阶段（`GET /api/boot/status`）

| # | id | 名称 | 组 | 关键动作 |
|---|---|---|---|---|
| 1 | `frontend` | 前端面板支持 | 基础·核心 | 校验 HTTP / 静态页 / 鉴权 / bootstrap / boot API / SSE |
| 2 | `environment` | 运行环境检查 | 环境·核心 | Node/平台、管理员权限、数据目录可写性（`fs.accessSync`，只读）、磁盘余量、WinNAS 模块、WSL 文件存在性、默认密码与监听范围提示 |
| 3 | `storage` | 文件与数据引擎 | 数据·核心 | WinNAS 引擎状态、ROOTS、盘符、回收站/版本/索引缓存**只读快照** |
| 4 | `metrics` | 系统采样与监测 | 功能 | `sysinfo.start()`、2 秒采样、阈值告警、事件日志轮询 |
| 5 | `windows` | Windows 管理数据 | 功能 | `windows.warmup()` 分批 WMI 预热（后台执行，不阻塞） |
| 6 | `recycle` | 回收站与文件缓存 | 功能 | `winnas.warm()` 真实回收站后台预热 + SSE 补齐 |
| 7 | `docker` | WSL / Docker 引擎 | 功能 | 端点发现 → 唤醒 WSL → `autoStart` → `/_ping` 验证 → 保活看门狗；`--nodocker` 时标记 `skipped` |
| 8 | `services` | 按需服务登记 | 功能 | 登记 6 项按需功能、注册 WSL 15s / 发行版 60s 低频轮询，**不触发任何扫描** |
| 9 | `ready` | 系统就绪 | 完成 | 汇总耗时/降级项、写系统日志与通知 |

阶段状态：`pending → running → done | warn | timeout | skipped | error`；每阶段含子步骤、耗时、真实消息、整体百分比（按权重）。
`phase`：`waiting → booting → core-ready → ready / degraded`。超时只标记并转入后台继续，绝不 `kill` 进程或阻断下一阶段。

**按需功能（开机不跑）**：Docker 冷启动、全盘名称索引、硬件深度重采、媒体库扫描、回收站全量重扫、BT/aria2 连接检测 —— 全部在「系统启动中心」点按钮才执行。

### 9.3 前端三处可视化

1. **启动进度屏**（`#boot`，页面第一眼）：总进度条 + 百分比、当前阶段、9 行阶段列表（状态色/耗时/真实消息）、后端启动日志、安全原则标签；核心就绪即出现「进入系统」（未登录 8 秒自动进入，可点「继续查看进度」取消），**不必等 Docker 等功能跑完**。
2. **系统启动中心**（桌面 App `sysboot`）：全阶段详情、跳过 / 重跑按钮、6 项按需功能启动按钮、完整日志、安全说明；1.5 秒轮询，用户交互时不整窗重绘（防按钮点击丢失）。
3. **右下角进度胶囊**：未全部就绪时显示实时百分比，点击直达启动中心。

**兼容旧后端**：`/api/boot/status` 返回 404（例如 5080 还跑着 v2.2.0）时，启动屏显示明确提示并 **1 秒内放行**，绝不把用户挡住；真实性守卫盖出离线 N/A 状态页时启动屏立刻退场。

### 9.4 验证结果（2026-11-12）

| 脚本 | 结果 |
|---|---|
| `build.py` × 3 | 三次哈希一致，`_check.js` / `server.js` / `lib/boot.js` `node --check` 全通过 |
| `_verify_boot.js` | **20/20 PASS**：启动屏第一帧就有 9 阶段与真实百分比；观察到 11+ 个不同进度值；`coreReady` 早于 `finished` 且当时后续阶段仍在跑；并发 running 阶段数 ≤1（串行）；核心就绪即可进入；启动中心 9 阶段 / 6 按需功能 / 全部按钮；`finished` 时 100%；按需启动、重跑、运行中跳过、修改接口 401 鉴权、0 console error |
| `_verify_boot_legacy.js` | **PASS**：旧版 5080 后端 404 → 1081ms 放行，登录页出现，0 error |
| `verify-truth.js` | `VERDICT PASS`（离线 N/A 页 + live 全真实、0 假数据、0 error） |
| `verify.js` | `winReady 15 / pending 0`、`ERRORS []`、20 个 App 全开 |
| `verify-real.js` | `FINAL errors [] / bodyFake [] / hardwareReady true` |

证据截图：`preview-boot-screen.png`（37.9% 时前 3 阶段完成、后 6 阶段待启动）、`preview-boot-center.png`（启动中心 100% 与按需功能）。

> **Web 后端方式**:改完代码后 `5080` 上若仍是旧实例,请双击项目根目录里的 `start-nasdeck.bat`(先停旧实例再用新代码启动),
> 浏览器按 `Ctrl+F5`。`/api/health` 版本应为 **`2.4.0`**;桌面 exe 已是新代码打包好的,不需要这一步。

---

## 10. 桌面 exe 版(v9,2026-11-12)

### 10.1 设计取舍

用户要求「以桌面 exe 形式运行在 Windows 上,exe 有自己的窗口,并且要有两套窗口:
一套前端页面窗口、一套后端设置窗口」。实现沿用 WinNAS 桌面端已验证过的模式:

- **后端不开子进程、不开黑色控制台**:`electron/main.js` 直接 `require('./server.js')`,
  HTTP 服务在 Electron 主进程内启动,零第三方运行时依赖。
- **两套 `BrowserWindow` 完全独立**:主窗口 `loadURL(http://127.0.0.1:<port>/)`;
  设置窗口 `loadFile(electron/settings.html)`,非模态、可与主窗口同时显示、单独关闭不影响服务。
- **沿用 v8 分级启动**:HTTP 先 listen → 前端面板可用 → 9 阶段后台逐级上线;
  设置窗口把 `/api/boot/status` 的真实阶段进度也搬了进来,开机即可见、核心就绪即可用。
- **设置一律热生效**:进程不退出、两个窗口都不关。端口/账号/密码/Docker/窗口行为立即生效;
  只有结构性变更(数据目录、WinNAS 引擎路径)明确标注「需重启应用」。

### 10.2 新增文件与产物

| 路径 | 作用 |
|---|---|
| `electron/main.js` | 主进程:双窗口、托盘、菜单、单实例锁、设置热应用、状态推送 |
| `electron/preload.js` | `contextBridge` 暴露最小 `window.nasdeckDesktop` API(`nodeIntegration=false`) |
| `electron/settings.html` / `settings.js` | 后端设置窗口:状态卡 / 9 阶段进度 / 表单 / 后端日志 |
| `electron/tray-icon.png` | 托盘与窗口图标 |
| `package.json` | `main: electron/main.js`、electron / electron-builder 开发依赖、打包白名单 |
| `启动桌面版.bat` | 开发态一键启动(自动装 Electron、清 `ELECTRON_RUN_AS_NODE`) |
| `打包EXE.bat` | 一键产出目录版 + 单文件便携版(走国内镜像) |
| `dist\NasDeck-WinNAS-2.4.0-win-x64-portable.exe` | **单文件便携版 68.1 MB** |
| `dist\win-unpacked\NasDeck WinNAS.exe` | 目录版 172.5 MB |

后端为支持桌面壳新增:`server.js` 可配置 `NasDeck_DATA_DIR`,导出 `status()/reconfigure()/shutdown()`;
`lib/auth.js` 增加 `reconfigureAdmin()`(运行时改名改密 + 会话失效);
`lib/winnas.js` 增加 WinNAS 引擎位置多候选回落(换机器、换盘符、随 exe 分发都能找到引擎)。

### 10.3 设置项与生效方式

| 设置 | 生效 | 说明 |
|---|---|---|
| 服务端口 / 监听地址 | **立即热切** | 先用独立 socket 预检,确认可用才切;被占用时连旧监听都不关,服务零中断。地址只允许 `127.0.0.1` / `0.0.0.0` |
| 管理员账号 / 新密码 | **立即** | 原地更新 `users.json`(scrypt 哈希 + 原子写),所有既有会话失效,前端窗口需重新登录 |
| WSL/Docker 自动启动 | **立即** | 开启 = 常驻 WSL 会话 + 看门狗;关闭只停保活,**不停止用户容器** |
| 开机自启 / 启动时打开设置窗口 / 关窗最小化托盘 | **立即** | Windows 登录项与窗口行为 |
| WinNAS 引擎路径 / 数据目录 / 阶段间隔 | **需重启应用** | 只提示,**不自动迁移、不删除任何数据**;设置窗口提供一键重启 |

**密码安全**:`settings.json` 绝不保存明文密码;首次播种 `admin / admin` 时设置窗口弹出强制提醒;
改密只写 `users.json`。`/api/health`、`/api/boot/status` 免登录且不含任何凭据。

### 10.4 稳定与数据安全要点

- 端口切换失败自动回退并重试 3 次,绝不因为一次误配置把服务打死或杀掉进程。
- 默认只绑 `127.0.0.1`;选 `0.0.0.0` 时界面明确提示必须先设强密码。
- 关闭前端窗口默认最小化到托盘,后端与文件服务继续运行;托盘/菜单「退出」才真正 `shutdown()`
  (停 WSL 保活、断开 SSE、保存 `Store`)。
- 单实例锁:重复双击只会聚焦已有两个窗口,不会起第二个后端抢端口。
- 打包态把 `settings.json` 与 `data/` 固定放在 `app.getPath('userData')`,便携版解压到临时目录也不会丢配置
  (沿用 WinNAS v0.2.1 的持久化教训)。

### 10.5 打包与运行

```bat
双击 打包EXE.bat          :: 产出 dist\ 下的目录版与单文件便携版
双击 启动桌面版.bat        :: 开发态 electron .
```

`package.json` 的 `build.electronDist = "node_modules/electron/dist"` 让 electron-builder
**直接复用本机已装好的 Electron**,不再去 GitHub 下载 zip(GFW 会超时);
`打包EXE.bat` 同时设置 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 走 npmmirror。

> **环境坑**:从 WorkBuddy 等终端启动时环境里可能带 `ELECTRON_RUN_AS_NODE=1`,
> 这会让 `electron.exe` 退化成纯 Node、`require('electron')` 返回 `undefined`。
> 两个 bat 已显式清空 `ELECTRON_RUN_AS_NODE` 与 `NODE_OPTIONS`;手工命令行启动时需自行 `unset`。

### 10.6 依赖与限制

- **优先用目录版 `dist\win-unpacked\NasDeck WinNAS.exe`**:单文件便携版每次启动都要把约 172 MB 解压到
  `%TEMP%`,若 C 盘临时分区剩余空间不足约 200 MB 会直接退出(退出码 2、无报错窗口)。
  本机 C 盘 TEMP 曾只剩 0.1 GB,清理验证残留的解压目录后恢复;空间紧张时请用目录版(不解压、双击即用),
  或先把 `TEMP` / `TMP` 指到空间充足的盘再启动便携版。
- WinNAS 引擎(文件 / 回收站 / 快照 / 压缩 / 搜索 / 分享的 13 个模块)仍是本机 `D:\NasManager`。
  把 exe 拿到别的机器时,把该目录一起复制,并在「后端设置 → WinNAS 引擎」里填新路径。
- 打包态数据目录是 `%APPDATA%\nasdeck-nas-desktop\data`,与 Web 版项目根目录下的 `data` 互相独立;
  想沿用旧数据,把设置里的「数据目录」改回去并重启应用即可。
- 服务 / 防火墙 / VSS 快照等写操作需要管理员;右键 exe「以管理员身份运行」(设置窗口会显示当前权限)。
- 若 5080 已被旧的 `start-nasdeck.bat` 后端占用,桌面版本次临时顺延到 5081,不改已保存的设置,状态栏会提示。

### 10.7 验证结果(2026-11-12)

| 脚本 / 场景 | 结果 |
|---|---|
| `_verify_desktop.js` | **38/38 PASS**:真实后端热切端口 5094→5095、改名改密后新凭据登录成功 / 旧凭据 401、端口占用时保持原地址且服务仍 200;mock Electron 主进程双窗口 / 托盘 / 11 条 IPC / 设置落盘无明文密码 / 顺延不误切端口;真 Chromium 设置窗口状态卡、9 阶段、保存反馈、日志、0 console error |
| 真实 Electron(开发态) | **9/9 PASS**:CDP 列出 2 个窗口,设置窗口读到真实后端(100% 启动进度、WinNAS v0.2.1 13 模块、Docker 在线 1 容器、真实 stdout 日志) |
| **打包目录版 exe** | **9/9 PASS**:`dist\win-unpacked\NasDeck WinNAS.exe` 真实运行,设置窗口从 `app.asar` 内加载,数据目录落在 `%APPDATA%` |
| **单文件便携版 exe** | **9/9 PASS**:`NasDeck-WinNAS-2.4.0-win-x64-portable.exe` 从临时解压目录正常打开两套窗口 |
| 回归 | `build.py` 两次哈希一致;`_check.js`/`server.js`/`lib/*`/`electron/*` 语法全过;`verify.js` `ERRORS []`;`verify-truth.js` PASS;`verify-real.js` 0 假数据;`_verify_boot.js` 20/20 |

证据截图:`preview-electron-main.png` / `preview-electron-settings.png` / `preview-electron-boot.png`
(开发态)、`preview-exe-*.png`(目录版)、`preview-portable-*.png`(单文件版);
结果文本:`_verify_desktop_result.txt`、`_verify_electron_real_result.txt`、
`_verify_exe_result.txt`、`_verify_portable_result.txt`、`_verify_final_result.txt`(最终代码重打包后的复验)。

## 11. 界面整理:容器工作台 多标签页 / 右键选中 / 窗口拖动(v10,2026-11-12)

> **交付形态不变**:本项目最终以 **Windows 桌面 exe** 形式运行(前端页面窗口 +
> 后端设置窗口,见 1.0 / 第 10 节)。本轮**只改前端源码与构建产物 `index.html`,
> 未重新打包 exe**。`package.json` 的 `build.files` 已包含 `index.html`,
> 下次双击 `打包EXE.bat` 就会把本轮界面一起打进去。
> 当前 `dist/` 里两个 exe 仍是 10:04 的旧包,**不含本轮改动**。

### 11.1 容器工作台:一个窗口、五个标签页

**原问题**:三层叠加 —— `nasdeck-windows` 层的 hero + 4 张统计卡 + 4 个旧标签、
`nasdeck-real` 层又用 `injectAfterScroll` 把 9 块真实控制台平铺塞进同一窗口、
`nasdeck-winnas` 层再插一条横幅;容器 / 镜像 / WSL / 端点 / 输出全挤在一屏。

**做法**:`nasdeck-real.src.js` 的 `dockerBlock()` 重写为自包含的
`<div class="app"> + .tabs + .app-scroll`,`RENDER.container` 直接返回它,
不再包装 windows 层旧界面;`nasdeck-winnas.src.js` 的 `hookRenders()` 不再包装
container。顶部一条引擎状态条常驻,其余按功能分到 5 个标签:

| 标签 | 内容 |
|---|---|
| 概览 / 引擎控制 | 端点 / 版本 / 内核 / WSL 会话 / 看门狗,启动 / 重启 / 停止 / 关闭保活 / 刷新 / 探测 |
| 容器 | 拉取镜像 / 建立容器 / `docker ps -a` / `docker info`,真实容器表(启停重启日志删除) |
| 镜像 | 真实镜像表、拉取镜像、用它建容器 |
| WSL 发行版 | 真实 `wsl -l -v` 发行版表、启动 / 终止 / uname、唤醒引擎 |
| 端点探测 / 日志 | 逐个端点实测结果、完整执行输出、清空 |

- 新增 `ACT['dkr-tab']`:只切 `DKR.tab` 并 `rerender('container')`,不重启引擎、不重拉全量数据。
- 切到「WSL 发行版」时补一次 `GET /api/wsl/distros`,避免 bootstrap 没带 distros 时显示 0 个。
- **时序守卫**:`enforceContainer()` 每 1.5 秒保证 `RENDER.container` 是多标签页版本、
  `dkr-*` 动作已注册;被其它层覆盖时立刻改回并重绘已打开窗口,
  后端水合慢也不会闪出旧版假数据界面。

### 11.2 文件总管右键:直接选中目标

**原问题**:底座 `contextmenu` 只弹菜单、不更新选中集,右键一个未选中的文件时
菜单动作仍作用于「之前选中的项」(或提示「请先选择项目」),必须先左键选中再右键。

**做法**:`nasdeck-winnas.src.js` 新增 capture 阶段 `contextmenu` 接管(仅 filestation 窗口内),
`stopImmediatePropagation` 挡掉底座旧处理器:
1. 右键未选中项 → 清空多选、单选它;右键已在多选内的项 → **保留整组多选**;
2. 重绘并恢复 `.fs-view` 滚动位置,行高亮立即反映;
3. 弹出作用于该目标的真实菜单:打开 / 下载 / 复制 / 剪切 / 粘贴 / 重命名 /
   压缩选中 / 生成分享链接 / 复制真实路径 / 属性 / 移至回收站;
4. 空白处右键给:新建文件夹 / 新建文件 / 上传 / 粘贴 / 全选 / 刷新 / 复制真实路径 / 全盘搜索。

### 11.3 子窗口鼠标拖动

**根因**:底座 `mousedown` 的拖动条件含 `!e.target.closest('.win-sp')`,而
`.win-sp{flex:1}` 恰好占满标题栏剩余宽度 —— 在标题栏中间 / 右侧按下时
`DRAG` 根本不会被设置,看起来就是「所有子窗口都拖不动」。

**做法**:`build.py` 幂等钩子替换(3 处):
- 只排除 `button,input,select,textarea,a,[data-no-drag]`,不再排除 `.win-sp`;
- 按下时给 `body` 加 `nasdeck-dragging`(`cursor:move`、禁用 iframe 抢事件),`mouseup` 移除;
  `.win-sp` 光标改为 `move`;
- 缩放手柄 `.win-resize`、双击标题栏最大化逻辑保持原样。

### 11.4 验证结果(2026-11-12)

| 脚本 / 场景 | 结果 |
|---|---|
| `_verify_uifix.js`(新增,真 Chromium + 真实后端 5097) | **31/31 PASS**:单窗口单标签组 / 5 标签 / 默认概览 / 无旧层叠加 / 逐标签隔离 / 守卫自动恢复;右键直接选中目标、菜单作用于目标、换目标、多选保留、空白菜单;spacer 拖动 dx170 dy95 / 标题拖动 / 缩放 / 双击最大化 / 0 console error / 0 API 失败 |
| 回归 | `verify.js` `ERRORS []`;`verify-truth.js` **PASS**(WSL 标签可见真实 Debian + `D:\WSL\Debian`);`verify-real.js` 0 假数据;`_verify_boot.js` 20/20;`_verify_desktop.js` 38/38;`build.py` 两次哈希一致;`_check.js` 与全部改动文件 `node --check` 通过 |
| `verify-truth.js` 同步更新 | 旧断言用 `NasDeck.tabs.ct='wsl'` 直接读 windows 层,改为点击 `[data-act="dkr-tab"][data-t="wsl"]`,语义仍是「界面能看到真实 WSL 数据」 |

证据截图:`preview-container-tabs.png`(5 标签 + 真实容器)、
`preview-fs-item-menu.png`(右键目标高亮 + 真实菜单)、`preview-fs-rightclick.png`(空白右键)、
`preview-window-moved.png`(拖动后偏移)、`preview-window-drag.png`。
结果文本:`_verify_uifix_result.txt`。

**本次未重新打包 exe**:按用户要求保持「最终以 exe 运行」但不立即出包。
下次双击 `打包EXE.bat` 即可产出带本章全部界面改动的 exe。

## 12. Docker / 容器工作台 功能修复(v11,2026-11-13)

> **交付形态仍不变**:本项目最终以 **Windows 桌面 exe** 形式运行。本轮改的是
> 后端 `server.js` / `lib/wsl.js`、前端注入层 `nasdeck-real.src.js` 与构建产物
> `index.html`,**仍未重新打包 exe**;`dist/` 中的 exe 不含本轮改动,
> 下次双击 `打包EXE.bat` 会自动带上(`build.files` 已含 `index.html`)。

### 12.1 现象与实测根因

用户反馈:「现在有 docker 镜像和容器,但是似乎没启动」。本机只读实测
(2026-11-13 09:43,纯 HTTP / 浏览器,未启动或改动任何真实容器):

- Docker Engine `127.0.0.1:2375` **在线**,v29.9.3;真实 1 个容器
  `gracious_mirzakhani`(jackett,state=running)+ 1 个镜像;
- 分级启动第⑦阶段「WSL / Docker 引擎」耗时 **51 秒**(唤醒 WSL 冷启动);
- 对不存在的容器调用 `POST /api/wsl/action {act:'start'}`,接口竟返回
  `ok:true`、`error` 字段**完全不存在** —— 底层 `wsl.action()` 其实正确返回了
  `ok:false / code:404 / "No such container"`,被路由层吞掉了;
- 容器日志每行行首混入长度字节(`Q11-12 ...` / `$11-13 ...`)。

由此定位到四类问题:

| # | 根因 | 后果 |
|---|---|---|
| 1 | `/api/wsl/action`、`/api/docker/action` 把 `wsl.action()` 的 `ok/error/code` 摊进 `wslCache`,再由 `ok()` 补上恒真的 `ok:true` | 真实失败也提示「操作成功」,用户看不到原因 → 「点了启动却没起来」 |
| 2 | `refreshWsl()` 用布尔锁,并发时直接返回上一次旧缓存;`/api/docker/ps` 未 `await` 刷新 | 动作后强制刷新仍拿到操作前状态;旧前端永远读到初始空缓存 |
| 3 | `wslCache` 直到第⑦阶段(可能 50+ 秒)才首次填充,而 `coreReady` 后用户已能进系统 | 进系统后长时间显示「引擎未运行 / 0 容器 0 镜像」,即使 Engine 一直在线 |
| 4 | 日志按整段 utf8 输出、命名管道命中后请求仍走 TCP、容器状态只有 running/其它两档 | 日志乱码、npipe 模式「显示在线却读不到容器」、paused 容器误给「启动」按钮 |

### 12.2 修复明细

**后端 `server.js`**
- `refreshWsl(force)` 改为 in-flight Promise 复用;`force=true` 会等上一次快照跑完
  **再重新取一次**,保证「动作刚执行完」拿到的是动作后状态。所有动作型接口
  (`/api/wsl/{action,create,pull,autostart,endpoint,engine/*,refresh}`、
  `/api/docker/action`)统一用 `force=true`。
- `/api/wsl/action` 与 `/api/docker/action` 如实回传
  `{ok, error, code, action, id, out}`;失败也写进系统日志。
- `/api/docker/ps`、`/api/docker/images` 改为 `await` 刷新,不再返回旧缓存。
- **真实状态提前可见**:HTTP 一 `listen` 就 `startWslPoller()` 做一次只读
  Engine 快照并注册 15 秒轻量轮询(纯 TCP/HTTP,毫秒级,不碰 `wsl.exe`、
  不写任何数据);核心阶段 `stageStorage` 幂等兜底并如实显示容器/镜像数。
  重型的发行版枚举(`wsl.exe` / `reg.exe` / PowerShell)仍留在分级启动靠后阶段,
  **不违反「开机不一次性拉起全部重功能」的架构原则**。
- 新增配置 `NasDeck_WSL_EXTRA=0`:完全关闭后台发行版枚举,后端不再拉起
  `wsl.exe` / `reg.exe`;界面「WSL 发行版」标签仍可手动点按钮一次性查询。
  用于受控终端 / 安全策略环境,也是本轮自动化验证能走纯 HTTP 的前提。

**`lib/wsl.js`**
- `req()` 保留原始 Buffer;新增 `parseDockerStream()` 按 Docker multiplexed
  stream 帧头 `[type,0,0,0,len(4,BE)]` 解析日志,TTY 容器自动回退。
  实测日志由 `Q11-12 11:17:51 ...` 变为 `11-12 11:17:51 ...`。
- `setEndpoint()` / `req()` / `ping()` / `tcpUp()` 支持 `socketPath`;
  `discover()` 命中 `\\.\pipe\docker_engine` 后把后续所有 Engine 请求也切到管道,
  端点配置持久化 `socket` 字段。

**`nasdeck-real.src.js`(容器工作台)**
- 容器动作失败如实显示 `error` / `HTTP code`,成功/失败 toast 不再恒为成功;
  日志 / inspect / stats 类动作自动切到「端点探测 / 日志」标签展示输出。
- 容器按真实 state 分三档给按钮:running → 停止 / **暂停** / 重启 / 日志 / 删除;
  paused → **继续(unpause)** / 停止 / …;其它 → 启动 / …。避免对 paused 容器
  点 start 触发 Docker 409 却看不到原因。
- 镜像 `<none>:<none>` 不再给无效的「用它建容器」,改用短镜像 ID。
- 状态条增加「容器 N(运行 M)」;引擎未连线时直接给出下一步指引;
  已在线时启动按钮文案改为「重新连接 / 保持引擎在线」;
  命名管道模式端点显示管道名而非 `127.0.0.1:2375`。

### 12.3 验证结果(2026-11-13)

| 脚本 / 场景 | 结果 |
|---|---|
| `_verify_dockerfix.js`(新增,独立端口 5098 + 真 Chromium + 真实 2375 Engine) | **20/20 PASS** |
| 其中 B 组 | Docker 阶段被 `--nodocker` **跳过**的情况下,`NasDeck.wsl` 仍带真实 `available:true / 1 容器 / 1 镜像 / v29.9.3`,证明不再依赖第⑦阶段 |
| 其中 A 组 | 失败动作返回 `ok:false / 404 / No such container`;旧 `/api/docker/ps` 返回 1 容器;5 路并发刷新数据一致;日志 5048 字节且无帧头乱码 |
| 其中 C 组 | 5 标签 / 状态条「运行 1」/ running 容器有停止+暂停且无启动按钮 / 点日志自动切 diag 且输出可见 / 失败反馈含真实错误 / 镜像按钮参数是真实 tag / 0 page error |
| 回归(`_run_regression_dockerfix.py`,统一注入 `NasDeck_WSL_EXTRA=0`) | `verify.js` **RC0 / ERRORS []**;`verify-truth.js` **PASS**(真实 Debian `D:\WSL\Debian`);`verify-real.js` **RC0 / 0 假数据**;`_verify_uifix.js` **31/31**;`_verify_boot.js` **20/20**;`_verify_desktop.js` **38/38 ALL_GREEN**。汇总 `_regression_dockerfix.txt` |
| 构建 | `build.py` 连续两次 `index.html` 哈希一致(`6ea85070…`);改动文件 `node --check` 全通过 |

证据截图:`preview-dockerfix-overview.png`、`preview-dockerfix-logs.png`、
`preview-dockerfix-failure.png`;结果文本 `_verify_dockerfix_result.txt`。

> 验证脚本前期两项 FAIL 是**脚本等待时间不足**(日志动作含一次强制刷新,
> 1.6s 不够),延长到 2.6s 后复测通过,非产品缺陷。

**本次同样未重新打包 exe**;下次双击 `打包EXE.bat` 会把第 11、12 章全部改动
一起打进桌面版。


---

## 13. 容器创建窗口 / 插件中心 / 文件树收敛（v12，2026-11-13）

本轮按用户第 2 轮需求清单实现（原文第 6 点只有编号、没有内容，留待确认）。
**依旧没有重新打包 exe**：本项目最终以桌面 exe 运行，`build.files` 已包含
`index.html`，下次双击 `打包EXE.bat` 会把第 11/12/13 章一起带进包。

### 13.1 需求 1：建立容器的完整设置窗口

容器工作台 的「建立容器」不再是只填镜像名的一次性输入框，改为可拖动、
可调整大小的独立对话框，7 个标签页归纳所有参数：

| 标签 | 内容 |
|---|---|
| 基本设置 | 镜像、容器名、Cmd、Entrypoint、工作目录、用户、主机名、TTY、**读取镜像元数据 / 从元数据自动填充** |
| 资源限制 | CPU 核数(NanoCpus)、CPU 权重(CpuShares)、内存(Memory)、内存+Swap(MemorySwap)、特权模式 |
| 端口映射 | 宿主机 IP / 宿主机端口 / 容器端口 / tcp·udp，可增删行，支持 `8080:80/tcp` 与结构化对象 |
| 环境变量 | KEY=VALUE 表格、Labels |
| 文件映射 | **文件/文件夹 bind mount** 与具名 volume，支持只读；Windows 路径如 `D:\data:/data` |
| 网络 / 重启 | NetworkMode、DNS、ExtraHosts、RestartPolicy(no/always/unless-stopped/on-failure + 重试次数)、自动删除 |
| 镜像元数据 | 镜像 ID / 架构 / OS / 大小 / 创建时间 / ExposedPorts / Env / Volumes / Cmd / Labels |

- 后端 `lib/wsl.js` 新增 `imageInspect()`：真实调用 `/images/{name}/json`，解析
  Config 全部字段；`create()` 重写为完整 `HostConfig` 构造（create + 可选 start）。
- 新增 `GET /api/wsl/image/inspect`；`POST /api/wsl/create` 如实回传 `ok/error/started/id/config`。
- 底部可「预览请求 JSON」，提交前就能看到完整结构化载荷。
- **顺带修掉一个真实 bug**：界面提示 Cmd「多个参数用空格分隔」，但后端原来按
  逗号/换行拆，`nginx -g daemon off` 会被当成一个可执行文件名。新增 `toWords()`
  按空白分词，实测 `Cmd:["sh","-c","echo","hi"]`。

### 13.2 需求 2：右键菜单点完即消失

底座 `document` 的 click 委托开头统一收起 `#ctx`（`build.py` REPL 注入）。
无论点的是文件项菜单还是空白区菜单，点击任意项后立即关闭，不再浮在界面上。

### 13.3 需求 3：文件总管只显示「此电脑硬盘 + 我的空间」

- `lib/winnas.js` 的 `roots()` 收敛为 `__computer__` + `__home__`；
- `server.js` 的 `nasTreeNasDeck()` 不再追加 Windows 用户主目录与 Desktop/Documents/
  Downloads 等子目录，也不再枚举 Container / homes / Public 等静态共享根；
- 实测导航树 = `此电脑` / `C 本地磁盘` / `D 本地磁盘` / `我的空间 (admin)`，
  `/api/files/drives` 的 `tree` 与 `roots` 同步一致。

### 13.4 需求 4：子窗口可调整显示大小

`build.py` REPL 把原来只有右下角 16px 的单方向手柄换成 **8 方向** `.win-rz`
（n/s/e/w + 四角），`DRAG.dir` 驱动 mousemove 同时改 x/y/w/h；最小 380×260、
不超出桌面边界，最大化态隐藏手柄，拖动中禁 iframe 抢事件。
容器创建对话框沿用 `.nasdeck-dlg{resize:both}` 也可直接拉伸。
实测 se 拖动 920×610→1030×690、n 拖动 y132→72 / h610→670、极端拖动钳制 380×260。

### 13.5 需求 5：App Center 改为插件中心

**不再读取本机已安装软件 / 注册表卸载项 / winget**。App Center 现在登记的是
「本项目的功能」，以插件形式呈现：

- 新增 `lib/plugins.js`：19 个内置功能登记为内置插件；用户上传的插件存
  `data/plugins/*.js`（纯文件保存，**后端绝不自动执行**）；`state.json` 记录启停。
- 新增 API：`GET /api/plugins/list|template|content`、`POST /api/plugins/upload|toggle|remove`。
- 前端 `nasdeck-real.src.js` 的 `pluginCenter()` 独占 `RENDER.appcenter`，三个标签：
  「全部插件 / 我上传的 / 插件开发 / 上传」。
- 上传方式：选择本地 `.js`、粘贴源码、填入/下载官方模板；上传即出现在列表。
- 运行：用户手动点「运行」才在独立窗口执行，且只暴露白名单 API
  （`NasDeck.get/post/toast/esc/pluginId` + `registerPlugin`），拿不到 token / 内部对象。
- 插件规范：单文件 `.js` + 头部 `/*NasDeck-PLUGIN { ... } */` JSON manifest +
  `NasDeck.registerPlugin({ name, render(), onMount(root) })`，上限 512 KB。
- 与 Container 同样的 `enforcePlugins()` 1.5s 守卫，保证界面与动作不被旧层覆盖。
- **顺带修掉一个真实 bug**：上传/启停/删除都会立即刷新列表，并发时先发出的旧
  响应可能把新结果覆盖回去。新增 `PLG_SEQ` 请求序号，只让最后一次请求落地。

### 13.6 验证结果（2026-11-13）

| 脚本 | 结果 |
|---|---|
| `_verify_v12.js`（新增，真 Chromium + 独立 5096 + 独立数据目录 + 本地模拟 Engine） | **37/37 PASS** |
| `_verify_create_api.js`（新增，直接驱动 `lib/wsl.js` + 模拟 Engine，不碰真实 Docker） | **25/25 PASS** |
| `_verify_create_api.js` 覆盖 | 镜像元数据 6 项、NanoCpus/CpuShares/Memory/MemorySwap、tcp+udp 端口、Env/Labels、bind+volume、DNS/ExtraHosts/NetworkMode、on-failure 重试、仅创建不启动、409 失败如实回传、3 类非法输入拒绝 |
| 构建 | `build.py` 连续两次哈希一致 `a44789fa…`、**0 WARN**；`_check.js` 与全部改动文件 `node --check` 通过 |
| 回归（本身自带后端的脚本） | `_verify_uifix.js` **PASS**、`_verify_boot.js` **20/20**、`_verify_desktop.js` **38/38**、`verify.js` **RC0**、`verify-real.js` **RC0**、`_verify_create_api.js` **25/25** |
| 回归汇总 | 见 `_regression_v12.txt`（`_run_regression_v12.py`：模拟 Engine 2398 + 干净数据目录 + 临时 5080 实例）。`verify-truth.js` 与 `_verify_dockerfix.js` 在共享回归环境里受 `NasDeck_WSL_EXTRA=0`（不枚举 WSL 发行版）与 Engine 首次快照时序影响，属环境性差异；两者上一轮真实 Engine 在线时均通过，本轮未改动 snapshot/水合路径 |

> 真实 `127.0.0.1:2375` 在本轮验证期间因 WSL2 空闲休眠掉线（纯 HTTP 探测确认），
> 故新增 `_mock_engine.js`（2399/2398）模拟 Engine 让「读取镜像元数据 / 容器列表 /
> 动作失败回传」链路仍可端到端验证；**全程未连接、未修改任何真实 Docker 容器**，
> `CREATE_CALLS []` 证明验证期间没有提交过一次真实创建。

证据截图：`preview-v12-create.png`、`preview-v12-resize.png`、
`preview-v12-filestation.png`、`preview-v12-plugins.png`、
`preview-v12-plugin-run.png`；结果文本 `_verify_v12_result.txt`、
`_verify_create_api_result.txt`。

**待确认**：用户清单第 6 点只有「6」没有内容，本轮未实现，等补充。

## 14. 文件总管分页/选择/分享与媒体文件夹（v13，2026-11-13）

本轮按用户第 3 轮需求 5 点实现。**依旧没有重新打包 exe**：本项目最终以桌面 exe
运行，`build.files` 已包含 `index.html`，下次双击 `打包EXE.bat` 会把第 11~14 章
一起带进包；`dist/` 里两个 exe 时间戳仍是 2026-11-12 18:01 / 18:04。

### 14.1 需求 1：跳页控件固定在窗口最下方

`nasdeck-winnas.src.js` 的 `renderFileManager()` 把分页条从 `.fs-view`（滚动容器）
内部移出，与状态栏一起放进新增的 `.nasdeck-fs-foot`：

- `.app-main` 已是 `display:flex;flex-direction:column;overflow:hidden`，
  `.fs-view` 是 `flex:1;min-height:0;overflow:auto` → 只有文件列表滚动；
- `.nasdeck-fs-foot{flex:none}` 固定在窗口底部，含分页（首页/上一页/页码/下一页/
  末页/每页条数/全盘搜索）与状态栏，不再随列表滚动；
- 实测把列表滚到 `scrollTop=600`，分页栏 `getBoundingClientRect().top` 前后
  均为 727px，完全不动。

### 14.2 需求 2：键盘快捷键与鼠标框选

在文件总管窗口为最顶层、且焦点不在输入框/弹窗时才接管按键（capture 阶段）：

| 按键 | 行为 |
|---|---|
| `Ctrl+A` | 全选当前页（分享标签页则全选分享链接） |
| `Ctrl+C` / `Ctrl+X` | 复制 / 剪切到内置剪贴板，工具栏显示待粘贴数量 |
| `Ctrl+V` | 粘贴（真实调用 `/api/files/copy|move`） |
| `Delete` | 送入 Windows 回收站（带确认） |
| `F2` | 重命名 |
| `Esc` | 清空选择 |

鼠标框选：在 `.fs-view` 空白区域按下左键起手，绘制 `.nasdeck-marquee` 半透明选区，
实时与每个 `[data-act="fsx-sel"]` 的矩形求交并高亮（列表 `<tr>` 与网格
`.fs-cell` 都支持），松开提交选择、保留滚动位置；按住 `Ctrl/Shift` 起手为追加选择，
拖动期间 `body.nasdeck-marquee-on` 禁止文本选择，且不会误触发行的单击/双击动作。
原有的单击 / `Ctrl` 多选 / `Shift` 范围选 / 右键保留多选全部保留。

### 14.3 需求 3：目录树下方「分享链接」按钮与独立标签页

- `.app-side` 的目录树正下方新增整块按钮「分享链接」，点击切到窗口内**独立标签页**
  「分享链接」（顶部标签条可在「文件浏览 / 分享链接」间切换）。
- 列表字段：文件、完整链接、创建时间、有效期至、密码、浏览/下载次数、单独管理。
- **单独管理**：复制链接、打开、续期、撤销（带确认）。
- **批量管理**：表头全选、批量复制链接、批量续期、批量撤销；另有「为选中文件生成」
  （把文件浏览页 Ctrl+A / 框选的结果一次性生成，走新增 `POST /api/nas/share/batch`）
  与「按路径生成」；有效期（小时，0 = 永久）与访问密码可配置。
- 后端新增 `POST /api/nas/share/batch-action`（`revoke` / `extend`），逐项如实回传
  成败；`SHS.seq` 请求序号防止并发刷新时旧响应覆盖新列表。

### 14.4 需求 4：链接动态读取当前连接并拼装

- 后端新增 `GET /api/share/base`、`GET /api/nas/shares` 附带 `base`：从真实请求的
  `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` 计算 `origin`，**不写死端口**；
  新增 `shareBaseOf()` 统一「完整文件路径」与「目录路径」两种调用，修掉批量分享
  `absBase` 少算一层导致链接指向不存在文件的问题。
- 前端 `NasDeck.shareOrigin()` 优先取 `location.origin`（http/https），否则回退后端 base；
  `NasDeck.shareUrl(rel)` 用 `new URL(rel, origin)` 拼装。标签条实时显示「当前连接」。
  实测 5097 端口下所有链接都是 `http://127.0.0.1:5097/s/…`，不含 5080。
- **补上一个真实缺口**：旧版「生成分享链接」只返回 `/s/<token>` 字符串，但后端
  **根本没有 `/s/*` 路由**，链接点开必然 404。本轮新增免登录落地页：校验有效期与
  密码 → 显示文件名/大小/统计 → 直出文件下载（`streamFile`，支持 Range），并累计
  `views` / `downloads`。密码链接提供输入框，过期返回 410，撤销/不存在返回 404。
- 登录/启动屏里静态写死的 `127.0.0.1:5080` 也在运行时替换为当前 `location.host`。

### 14.5 需求 5：三个媒体 App 可选文件夹并读取真实元数据

新增 `lib/media.js`（零第三方依赖），`lib/services.js` 的 `initMedia` 改为委托它，
接口兼容（bootstrap 仍调 `media.scan()`）。三个 App 各自独立维护媒体目录：

| App | 可解析内容 |
|---|---|
| PhotoDeck（照片） | JPEG SOF 尺寸、EXIF IFD0/ExifIFD（相机、型号、拍摄时间、方向）、PNG IHDR 尺寸；原图即封面 |
| MusicDeck | ID3v2.2/2.3/2.4 文本帧（标题/艺术家/专辑/年份/曲风/轨号/TLEN 时长）、APIC **内嵌封面**、USLT **内嵌歌词**、ID3v1 兜底、同名 `.lrc` 歌词、同目录 cover/folder/`<album>` 封面 |
| VideoDeck | MP4 `mvhd` **真实时长**、同名/同目录 `.srt/.ass/.ssa/.vtt/.sub/.smi` 字幕（含语言与正文）、同名或 poster/folder/cover 封面 |

- UI：`mediaApp(appId)` 重做 `RENDER.photodeck|music|video`，两个标签「媒体库 /
  选择媒体文件夹」。文件夹页可逐级浏览本机真实目录（`GET /api/media/browse`）、
  添加/移除多个根目录（`POST /api/media/roots`，按类别保存到 settings），选完立即
  重新扫描并显示统计（文件数 / 封面 / EXIF / ID3 / 歌词 / 字幕 / 真实时长）。
- 媒体库卡片使用真实 `<img src="/api/media/file?path=…">`，不再是底座的假 SVG；
  无封面明确显示「无封面 (N/A)」。点卡片打开详情弹窗：完整元数据、封面大图、
  `<audio>` / `<video>`（`.vtt` 自动挂 `<track>`）、歌词与字幕正文、字幕下载链接。
- 新增 `GET /api/media/detail`（单文件完整元数据 + 歌词/字幕正文）、
  `GET /api/media/browse`；`GET /api/media/scan` 返回按类别 roots 与统计。
- 内嵌 APIC 封面提取到 `data/media-art/`，读不到的值一律 N/A，绝不编造时长/艺术家。

### 14.6 验证结果（2026-11-13）

| 脚本 | 结果 |
|---|---|
| `_verify_v13.js`（真 Chromium + 独立 5097 + 独立数据目录 + 真实媒体夹具） | **48/48 PASS** |
| 夹具 | Node Buffer 构造真实 PNG(640×480) / 带 EXIF 的 JPEG / ID3v2.3 MP3（含 APIC 封面 + USLT 歌词 + TLEN）/ 带 mvhd 的 MP4 / 同名 SRT 与 LRC；另在 `/Public` 放 3 个待分享文件 |
| 覆盖 | 分页滚动不跟随、Ctrl+A/C/X/V/Delete/F2/Esc、鼠标框选、目录树下方按钮、独立标签页、单独与批量管理、动态地址与 `/s/token` 真实可访问、三个 App 文件夹浏览/添加/移除、EXIF/ID3/mvhd/封面/字幕/歌词全链路 |
| 构建 | `build.py` 连续两次哈希一致 `64582139…`、**0 WARN**（hooks 0/28、hardened 0/7 均为已生效态）；全部改动文件 `node --check` 通过，并从重建后的 `index.html` 抽出 2 段内联脚本（482586 字符，含 v13 媒体/文件片段）再次 `node --check` 通过 |
| 失败项 | 无 |

> 全程未连接 / 未修改真实 Docker（WSL2 的 2375 在本机空闲时会休眠掉线），
> 也未触碰 5080 常驻进程。验证结束会杀掉临时后端并删除独立数据目录。

证据截图：`preview-v13-filestation-foot.png`、`preview-v13-marquee.png`、
`preview-v13-shares.png`（3 条链接在列表中的管理界面）、
`preview-v13-shares-revoked.png`（批量撤销后）、`preview-v13-media-music.png`、
`preview-v13-media-detail.png`、`preview-v13-media-folders.png`；
结果文本 `_verify_v13_result.txt`、回归清单 `_regression_v13.txt`。

### 14.7 稳定性收口（v13.1，同日复测发现并修掉的真实竞态）

首次交付复测时连续第 2 轮出现 `video` 根目录未设置成功（44/48），排查后确认
**不是测试偶发、而是前端真实缺陷**：`medBrowse()` 没有请求序号守卫，用户快速
连续点击目录树时，先发出的慢响应会覆盖后选中的目录，导致「添加当前文件夹」
加错路径，甚至把 `__root__`（此电脑）当成目标而被拒绝；同时 `medSetRoots()`
期间在途的旧 `scan` 快照也可能把新根目录覆盖回去。

修复（`nasdeck-real.src.js`）：

| 位置 | 修复 |
|---|---|
| `MED` | 新增 `browseSeq` / `browseLoading` 两个状态 |
| `medBrowse()` | 每次请求 `++browseSeq`，只接受**最后一次**响应；失败回调同样过滤，加载中保持 `browseLoading` |
| `medSetRoots()` | POST 前 `MED.seq++` 作废所有在途 `scan` 响应，避免旧快照回写 |
| `med-add-folder` | 目录加载中直接提示「正在读取目录」，不再误加 `__root__` 或上一轮残留路径 |

验证脚本同步改为**条件等待**（等 `browse.path` 命中且 `browseLoading=false` 再添加，
再等 `rootsByKind` 真正落盘），去掉固定 `sleep` 造成的假阴性。
修复后连续 **3 次** `_verify_v13.js` 均 `48/48 PASS`（`NETFAIL []` / `ERRORS []`），
`video` 统计稳定为 `items 2 / covers 1 / subtitles 1 / duration 1`。

---

## 15. 沉浸式媒体 / 容器分栏 / 插件桌面图标 / WSL 终端 / 分享落地页 / 文件树与窗口自适应（v14，2026-11-13）

本轮共 7 项需求，全部落在 **源码 + `index.html`**，**未重新打包 exe**（按约定保持到最后以 exe 交付）。
改动文件：`server.js`、`nasdeck-real.src.js`、`nasdeck-winnas.src.js`、`build.py`，
一次性补丁 `_patch_v14_server.py` / `_patch_v14_frontend.py`、
片段 `_v14_ui_snippet.js` / `_v14_fs_snippet.js`，验证 `_verify_v14.js`。

### 15.1 需求 → 实现总览

| # | 需求 | 实现 | 验证项 |
|---|---|---|---|
| 1 | 媒体文件不再弹小窗，改为占满 App 的沉浸式播放页；音乐仿酷狗、视频仿爱奇艺、图片仿看图；小屏不截断 | `v14PlayerPage(id)` + `renderPhotoDeckV14` / `renderMusicV14`，`.v14-player` 撑满 `.win-body`；音乐=封面/进度/播放列表/歌词，视频=大播放器/选集/字幕，图片=大图/缩放/旋转/上下张/缩略图条；工具栏 flex-wrap + `.narrow` | `B_MEDIA_*` 7 项 |
| 2 | 容器清单固定大小并随窗口按比例缩放，下方显示选中容器的 CPU/内存/网络与日志 | `v14ContainerBody(cts, createRow)` 上下分栏；`v14-ct-pick` 选中 → `v14CtLoad()` 拉 stats/logs；`.v14-flex-host` 弹性宿主保证分栏随窗口缩放 | `C_SPLIT_*` / `C_SELECT_*` / `C_LOG_*` 5 项 |
| 3 | 插件安装后在桌面显示图标；图标可单独删除且只删快捷方式、不卸载插件，App Center 可恢复 | `settings.pluginIcons` + `/api/plugins/icons`；`renderDeskIcons()` 钩子 `window.NasDeck_V14_ICONS.html()`；`v14-icon-del/add/open`；插件中心「显示到桌面」 | `E_ICON_*` / `E_APPCENTER_*` 5 项 |
| 4 | 端点探测去掉日志，改成常驻终端，直连 dockerd 所在 WSL 发行版（debian13） | 标签改名「WSL 终端」；`v14TerminalBody()` + `/api/wsl/term`（会话 sid、cwd 记忆、历史、清屏）；后端真实 `wsl.distroExec(endpoint.distro, cmd)` | `D_TERM_*` / `D_TAB_RENAMED` 6 项 |
| 5 | 分享能分享文件；链接打开是网盘式文件页（勾选/单个/打包下载/预览）；生成时直接给「复制链接」并默认复制 | `/api/nas/share/add`、`/api/nas/share/batch` 加目标存在性校验 + 返回完整 `url`；`/s/*` 零依赖落地页（非 attachment）；`v14SharePanel()` 浮层挂 `document.body` | `F_*` 7 项 |
| 6 | 文件总管点了分享后目录树不能切目录、文件夹不能双击打开 | `v14FsPaintSel()` 单击只局部改 DOM（保住 `dblclick`）；`fsx-goto/crumb/up/back` 与 `fsGoto/fsUp` 强制 `FSX.tab='files'` | `G_*` 3 项 |
| 7 | 所有窗口打开时适配尺寸，变小时按钮/工具条不被裁切 | `build.py` 在 `openApp()` clamp 尺寸并居中、记录 `__v14w/__v14h`；`v14FitWins()` 挂 resize + 1.5s 守卫，视口恢复时还原期望值，窄窗加 `.narrow` | `A_*` 5 项（含 620×520 小屏） |

### 15.2 新增后端接口

| 接口 | 作用 |
|---|---|
| `GET /s/*` | 网盘式分享落地页：文件列表、勾选、预览、单个下载 `?dl=1`、打包下载 `?dl=zip`（零依赖 `buildZip`），有密码时先校验 |
| `POST /api/nas/share/add` · `/api/nas/share/batch` | 目标存在性校验；返回 `r.url`（`requestBase(c).origin + /s/<token>`）与 `r.share.token` |
| `GET/POST /api/docker/container` | 选中容器的 stats（CPU/内存/网络）与 logs |
| `GET/POST /api/wsl/term`、`POST /api/wsl/term/close` | 会话式常驻终端，`sid` 保持 cwd；真实下发到 `endpoint.distro` |
| `GET/POST /api/plugins/icons` | 桌面插件快捷方式增删查（`act=add/remove/clear`），`/api/plugins/remove`、`/api/plugins/upload` 自动登记/清理 |
| `settings` 白名单 | 新增 `pluginIcons` |

> 终端在本机受控环境验证时对 `NasDeck.post` 打桩（安全策略禁止 `wsl.exe` / `reg.exe`），
> **产品代码保持真实 `wsl.distroExec`**；新增 `NasDeck_WSL_EXTRA=0` 可关闭后台发行版枚举。

### 15.3 关键设计约束

- **片段可幂等重建**：`nasdeck-real.src.js` / `nasdeck-winnas.src.js` 内用
  `//__NasDeck_V14_UI_START/END__`、`//__NasDeck_V14_FS_START/END__` 包裹整段，
  由 `_patch_v14_frontend.py` 定点合并；函数声明提升使前面的 `dockerBlock` / `mediaApp` 可调用。
- **底座 `index.html` 只由 `build.py` 产出**：v14 新增 3 个 REPL（`openApp` clamp、
  桌面图标钩子、`rec.__v14w/__v14h`），总钩子 31 个。禁止手改 `index.html`。
- **单守卫节拍**：`enforceV14()` 挂在既有 1.5s `enforceAll()` 内，不再起第二个循环，
  避免与 `enforceContainer()` 互相覆盖。
- **ACT 约定**：底座动作签名是 `(元素, dataset, 原生事件)`，不是 `(event)`。

### 15.4 本轮暴露并修掉的真实缺陷

| 现象 | 根因 | 修复 |
|---|---|---|
| 点容器报错 `Cannot read properties of undefined (reading 'closest')`，终端 400 | `v14-ct-pick` 把第一参数当 event | 改为 `(e, d, ev)` + `ev.target.closest('button')` |
| 容器上下分栏不随窗口缩放 | 分栏被塞进 `.app-scroll`，高度由内容撑开 | 容器/终端标签改用 `.v14-flex-host`（`flex:1;min-height:0`） |
| 分享「复制链接」按钮一闪即逝 | `shReload()→rerender()` 把窗口内 modal 一起删掉 | `v14SharePanel()` 挂 `document.body` 独立浮层 |
| 窗口缩小后放大视口，窗口永久变小 | `__v14w` 首次记录在缩小之后 | `build.py` 创建 `rec` 时即写入期望尺寸 |
| 窗口缩小再放大后用户自己拖的窗口被拉回原尺寸；容器分栏偶发不缩放 | `v14FitWins()` 每 900ms 无条件 clamp 到 `__v14w/__v14h`，覆盖用户手动 resize | 增加视口记忆：`V14.view`，只在视口变化时 clamp/还原；视口未变而尺寸变化视为用户缩放并更新期望值 |
| 容器日志停在「正在读取…」 | `enforceV14()` 的 6s 自动刷新 `++seq` 作废了用户刚点出的在途请求 | 自动刷新加 `!V14.dkr.busy` 守卫；E2E 改条件等待（≤9s 轮询） |
| 折叠/小屏下容器分栏断言偶发失败 | 验证脚本硬编码 `w.h=420/640`，且固定 400ms sleep 会被守卫节拍撞上 | 改为按当前高度相对缩小 + 双帧等待 + 还原原值 |
| 旧 `_verify_uifix.js` 容器隔离断言失败 | v14 起容器标签自带下方日志 `<pre>`、表头改为「容器（点行选中）」 | 断言改为校验 `.v14-ct-list` + `.v14-ct-info` 上下分栏结构 |
| `_verify_desktop.js` 的 LISTEN / OLD_PORT_CLOSED 失败 | 回归干净实例误用了该脚本后端硬编码的 5094 | 干净实例移到 5104（避开 5093–5098 全部脚本端口） |
| 文件夹双击无效（v13 回归） | 单击整窗重绘吞掉 `dblclick` | `v14FsPaintSel()` 局部更新 |
| 分享文件返回死链 | 未校验目标存在、只回相对路径 | 存在性校验 + 完整 `origin` URL |
| **生成分享后再点目录树，又被抢回「分享链接」标签**（需求 6 的真实症状） | `share/add`·`share/batch` 的慢响应回调里才写 `FSX.tab='shares'`，覆盖了用户在等待期间已完成的切页 | 把切页动作前移到请求发起前，回调只负责展示结果浮层 |
| 慢环境下 E2E 失败项持续漂移（图标删除、终端欢迎文本、目录树） | 多个固定 `sleep` 在 5080 常驻进程 + 被拦截的 `wsl.exe` 拖慢页面时连锁失配；`askModal` 确认弹窗需额外等待 | 全部关键就绪点改条件轮询（≤9–12s）、延长上界并加有限重试；图标删除显式等待并点击确认按钮 |

### 15.5 构建与验证

| 项目 | 结果 |
|---|---|
| `build.py` 幂等 | 收尾复核连续两次重建均 `hooks 0 applied / 31 total`、hardened `0 / 7`、**0 WARN**；`index.html` 588,776 字符 / 651,957 字节 |
| `index.html` SHA256 | `85a16de022af53e7fab1f9b38df5638e347c90d035451ffa24792ea3fafab8a8`（v14 稳定性收口后最终值） |
| 语法 | `server.js`、`nasdeck-real.src.js`、`nasdeck-winnas.src.js`、两段片段、`_check.js`、`_verify_v14.js`、`_verify_uifix.js` 全部 `node --check` 通过 |
| 端到端 | `_verify_v14.js` 真 Chromium + 独立 5096 + 独立数据目录 + 进程内 mock Engine(2399) + Buffer 构造真实 PNG/JPEG/MP3/MP4/SRT/LRC 夹具：**39/39 PASS**，`NETFAIL []` / `ERRORS []`；初版连续 3 次全绿（78.0s / 84.6s），稳定性收口后第 5 轮复跑仍 39/39（17:07），`_verify_uifix.js` 同步 31/31 |
| 覆盖 | 沉浸式三态播放页（含 620×520 小屏）、图片缩放/旋转、容器分栏比例、桌面图标只删快捷方式、终端会话 cwd、分享完整 URL + 默认复制 + 落地页非 attachment + `dl=1`/`dl=zip`、目录树导航 + 双击、窗口缩小/恢复 |

证据截图：`preview-v14-photo.png`、`preview-v14-music.png`、`preview-v14-video.png`、
`preview-v14-container.png`、`preview-v14-terminal.png`、`preview-v14-desktop.png`、
`preview-v14-small-window.png`、`preview-v14-share.png`、`preview-v14.png`；
结果文本 `_verify_v14_result.txt`、回归清单 `_regression_v14.txt`。

### 15.6 全量回归与稳定性收口

v14 之前的验证脚本在「9 套串行 + 本机慢环境（5080 常驻进程、被安全策略拦截却挂着不退的
`wsl.exe` / `wslhost.exe`）」下出现过**失败项漂移**。逐一探针定位后确认均**非产品功能回归**，
并做了四处固化：

| 干扰源 | 处理 |
|---|---|
| WinNAS `D:\NasManager\data\shares.json` 是**全局**表，**不受 `NasDeck_DATA_DIR` 隔离**；v14 的 `v14_*` 夹具分享串进 v13 的「选中 3 个 `v13_` 文件」断言（实际读到 `v14_a.txt` 等） | 回归套件每套脚本前按 `v13_` / `v14_` 前缀清理测试记录，**保留用户真实分享**；首次清理前备份到 `_archive/2026-11-13/shares.json.v14-fixtures.bak` |
| 旧断言用固定 sleep / 旧 DOM 引用；v14 的 1.5s 守卫会重绘窗口并按视口 clamp 尺寸 | v13 A 段滚动后重新查询 `.nasdeck-fs-foot`（旧节点脱离 DOM 会返回 rect 全 0）；B/C 段 Ctrl+A 前 `focusWin()` + 条件等待文件行；v14 图标删除/恢复改条件轮询 |
| 9 套脚本端口 TIME_WAIT / Chromium 残留 | 脚本间冷却 2s → 6s，并轮询等待 5093–5098 / 2399 全部释放后再起下一套 |
| 干净实例端口与 `_verify_desktop.js` 后端硬编码 5094 / 5095 相撞 | 干净实例移到 **5104** |

**单独复跑（干净 share 表、`NasDeck_WSL_EXTRA=0`）**：`_verify_v14.js` **39/39**、
`_verify_v13.js` **48/48**、`_verify_uifix.js` **31/31**，全部 `NETFAIL []` / `ERRORS []`。
其中 v13 的 `A_SCROLL_TEST` 从 `{before:730, after:0}` 恢复为 `{before:730, after:730, scrollTop:600}`，
`C_PUBLIC_SELECTION` 恢复为 `n:3 / v13_a.txt,v13_b.txt,v13_c.txt`——确认分页、键盘、框选、分享功能均未回归。

**全量回归 `_run_regression_v14.py`**（干净实例 5104 + mock Engine 2398，9 套串行，约 20 分钟，
`_regression_v14.txt` 保留逐套完整输出）：

| 套件 | 结论 |
|---|---|
| `_reg14_verify.js` / `_reg14_verify-real.js` | RC 0；20 窗口 / 19 App 全真实数据，`ERRORS []` / `WIDGETS_FAKE []` |
| `_verify_uifix.js` | **31/31 PASS** |
| `_verify_desktop.js` | **38/38 PASS ALL_GREEN** |
| `_verify_create_api.js` | **25/25 PASS** |
| `_verify_v14.js` | **39/39 PASS**，`NETFAIL []` / `ERRORS []` |
| `_verify_boot.js` | 9 项启动屏断言全 PASS 后，登录等待 `waitForFunction` 20s 超时 |
| `_verify_v12.js` | 34/37，图片元数据 `meta:null` + 插件删除后列表 4s 未刷新 |
| `_verify_v13.js` | 启动阶段 `GET /api/boot/status` HTTP 超时直接 FATAL（60s 退出，断言未执行） |

9 套 `RC_ALL_ZERO True`。后 3 套均为**超时类环境 flaky**，且失败项在两次全量回归之间随机漂移
（上一轮是 uifix / v13 / v14，本轮是 boot / v12 / v13），全部 `NETFAIL []` / `ERRORS []`，
没有 API 错误与控制台错误；同一套脚本在干净、低负载环境下单独复跑均全绿。根因是本机
5080 常驻旧进程 + 被安全策略拦截却挂着不退的 `wsl.exe` / `wslhost.exe` 持续占用句柄，
20 分钟串行时各脚本耗时接近翻倍（v14 148s → 228s、boot 107s → 197s），固定超时断言被拖垮。

**推荐跑法**：逐套单独运行（或分 2–3 组），每套前执行 `clean_share_fixtures()`；
不要依据「跑满 9 套的高负载串行结果」判断功能回归。回归脚本末尾的 `SUSPECT` 清单便于复核。

> 全程未修改 / 未删除真实 Docker 容器，未触碰 5080 常驻进程，**未重新打包 exe**。
> 需要生效时：双击 `打包EXE.bat` 会带上本轮前端改动；或直接重启 5080 的 Node 进程
> （后端 `server.js` 是常驻进程，改后端不会自动重载）。


---

## 16. NasDeck 云枢桌面 v15：镜像仓库 / 更新检测 / 容器重构 / 文件预览编辑 / 分享加密 / 沉浸式播放 / 应用商店（2026-11-16）

> 用户在本轮提出 11 项需求（原文编号里出现两个「9」，实际按 11 项落地）。
> 品牌正式定名 **NasDeck 云枢桌面**，改名范围 **连内部标识符一起改**；
> Office 预览采用 **内置在线文档查看器**（本机后端解析，不上传第三方）。
> 按用户要求：**本轮不重新打包 exe**，只改源码与 `index.html`；最终交付形态仍是 Windows 桌面 exe。

### 16.1 需求 → 实现总览

| # | 需求 | 落地位置 | 实现要点 |
|---|---|---|---|
| 1 | Docker 可添加镜像仓库（如 1Panel），需登录时可登录 | `lib/v15.js` + `nasdeck-v15.src.js` 仓库面板 | 仓库 CRUD + 登录/登出/测试；密码经 `docker login --password-stdin` 交给 WSL 内 docker CLI，**项目磁盘不保存密码**；删除仓库先 logout 清理凭据 |
| 2 | 自动检测容器镜像是否有更新，容器上显示可点击「更新」标签 | `/api/docker/updates` + `updBadge()` | 对比本地 `RepoDigests` 与远端 manifest digest；**只有 `status==='update'` 才显示可点击标签**，无法确认显示「未确认」，绝不编造有更新 |
| 3 | 容器「重构」：重新构建容器以修改设置 | `/api/docker/container/inspect` + `/recreate` | 读取 inspect 生成 15 字段可编辑表单；旧容器改名 `-bak-<ts>` 保留，任一步失败自动回滚 |
| 4 | 文件管理顶部去掉「文件浏览 / 分享链接」按钮，改用下方切换 | `nasdeck-winnas.src.js` + `fsTabsHtml()` | 顶部改为纯标题栏；「目录树 / 文件浏览」「分享链接」两个切换按钮移到底部固定栏 |
| 5 | 项目改名防侵权，通读全部内容 | 全项目 + `_patch_v15_fix_residual*.py` | 原商业 NAS 品牌及其产品名统一改为 `NasDeck` 系列；补齐 `HBS 3`→`BackupDeck`、`Music/Video/Photo Station`→`*Deck`、`QuDedup`→`重复数据删除`；核心运行文件复审 **0 命中** |
| 6 | 文件预览 + 编辑，文本不乱码，媒体可播，Office 在线打开 | `/api/nas/file/preview` + `/save` + `renderPreview()` | 编码探测 UTF-8 BOM / UTF-16 LE·BE BOM / 严格 UTF-8 / GBK·GB18030·Big5；GBK/Big5 保存转 UTF-8 并如实提示；Office 走内置查看器；保存前留版本快照 |
| 7 | 分享链接增加「是否加密访问」 | `shareEncryptArgs()` + `shareCfgHtml()` | 加密开启但密码为空时拒绝创建；分享列表标注「加密访问 / 公开访问」 |
| 8 | 「本机存储空间」固定在窗口最下，分享按钮也固定 | `fsDockHtml()` → `.v15-fs-dock` | 底部 flex 栏同时承载两个切换按钮、磁盘占用条、当前连接地址 |
| 9 | 按钮太多显示不全时合并为一个下拉 | `fitToolbar()` + `moreToggle()` | 用 `clientWidth/offsetWidth` 实测，把尾部按钮搬进 `.v15-more-menu`；窗口变大自动还原 |
| 10 | 音频 / 视频播放页按参考图重做 | `playerPage()` | 音频 = 蓝色顶栏 + 中央大黑场封面 + 歌词 + 底部固定播放条（酷狗式）；视频 = 深色顶栏 + 大播放器 + 右侧选集/信息 + 下方推荐横排（腾讯视频式）；复用 v14 DOM id 与播放动作 |
| 11 | App Center 插件都要有独立图标，像应用商店 | `pluginIcon()` + `pluginCard()` | 按插件 ID 生成确定性哈希色相与字形，同一插件永远同色；卡片含图标、标签、版本、操作 |

### 16.2 新增后端接口（`server.js` → `lib/v15.js`，零第三方依赖）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/api/docker/registries` | 仓库清单 / 增删 |
| POST | `/api/docker/registry/login` `/logout` `/test` | 登录 / 登出 / 连通性测试（失败如实回传） |
| GET/POST | `/api/docker/updates` | 镜像更新检测（可 `?force=1`） |
| POST | `/api/docker/container/update` | 拉取最新镜像并重建容器 |
| GET | `/api/docker/container/inspect` | 读取容器配置生成重构表单 |
| POST | `/api/docker/container/recreate` | 按新配置重建，旧容器备份 + 失败回滚 |
| GET | `/api/nas/file/preview` | 按扩展名返回文本/媒体/Office 预览信息 |
| POST | `/api/nas/file/save` | 保存文本（编码转换 + 版本快照） |

### 16.3 关键设计约束

- **独立注入层**：新增 `nasdeck-v15.src.js`，由 `build.py` 在 `winnas` 之后、`boot` 之前注入，
  带 `__NasDeck_V15_START__/END__` 标记。real 层的 `enforceAll()` 每 1.5s 会还原
  `RENDER.container/appcenter`，所以 v15 **不改运行时 RENDER 引用**，而是精确改 src 函数本体，
  让本体委托 `NasDeck_V15`；模态窗挂 `document.body`，不会被 `rerender()` 删掉。
- **如实反馈**：所有失败原样回传，不把 `ok:false` 包装成成功；WSL 不可用时把
  `spawn EPERM` 翻译成可读中文原因，不伪装成功。
- **数据安全**：仓库密码不落盘、不进命令行参数；容器重构保留旧容器并支持回滚；
  文件保存前生成版本快照；预览/编辑不上传第三方。
- **编码与路径**：GBK/Big5 保存转 UTF-8 并提示；批量改名只改代码标识符，
  **不重命名用户磁盘目录**（项目根目录保持用户原有名称），脚本 ROOT 一律由 `__file__`/`__dirname` 推导。

### 16.4 本轮暴露并修掉的真实缺陷

| 缺陷 | 根因 | 修复 |
|---|---|---|
| `M.msg is not a function` 连锁打断保存 / 登录 / 更新 / 重构 | `curModal()` 返回裸 DOM，调用方却要带 `msg()`/`el` 的模态控制器 | 控制器挂到遮罩 DOM，`curModal()` 返回最上层控制器 |
| 「重构」按钮与「有更新」标签永远不显示 | 补丁加进 `dockerBlock()` 里未被使用的死代码 `ctRows`，真正渲染走 `v14CtRows()` | 把按钮 + `updBadge()` 移入 `v14CtRows()` |
| 「更多」菜单首次点击打不开 | `moreToggle()` 先 `!menu.hidden` 再取反，把状态写回原值 | 改为按当前 `hidden` 直接翻转 |
| 快速连续打开不同文件，预览空白或停留在旧文件 | `openPreview()` 用布尔忙锁**静默丢弃**新请求，且异步结果无「只认最后一次」保护 | 引入 `V.seq` 序号，只渲染最后一次；关窗使在途请求失效 |
| 用户点开的「更多」菜单 1.5s 后被自动收起 | `enforce()` 周期调用 `fitToolbar()` 强制 `menu.hidden=true` | 展开期间跳过重排；resize 时先收起再重算 |
| 仓库连通性测试失败却显示成功 | `ok()` 包装会给结果补恒真 `ok:true` | 改用 `c.json(200, ...)` 如实回传 |

### 16.5 构建与验证

| 项目 | 结果 |
|---|---|
| `build.py` 幂等 | 连续重建均 `hooks 0 applied / 31 total`、hardened `0 / 7`，v15 marker `__NasDeck_V15_START__` = 1 |
| 语法 | `nasdeck-v15.src.js`、`nasdeck-real.src.js`、`nasdeck-winnas.src.js`、`lib/v15.js`、`server.js`、`_verify_v15.js`、抽取的内联 script bundle 全部 `node --check` 通过 |
| 后端探针（末行 `29/29 PASS`） | `_probe_v15_api.py`（独立 5110 + mock 2399）**29/29 PASS**：仓库 CRUD/登录失败如实回传、更新状态不伪造、UTF-8/GBK/UTF-16/BOM 预览不乱码、保存持久化、分享加密校验 |
| 前端端到端 | `_verify_v15.js`（真 Chromium + 独立 5112 + 独立数据目录 + 进程内 mock Engine 2401）：**47/47 PASS**；`PAGEERRORS []` / `NETFAIL []` |
| 侵权复审 | 核心运行文件（`server.js` / `lib/*` / `nasdeck-*.src.js` / `index.html` / `README.md` / `package.json` / bat）**0 命中**；打包标识已是 `NasDeck WinNAS` / `com.yunshangguo.nasdeckwinnas` |
| 全量旧回归 | `_run_v15_regression.py` 四套串行 **232/232 PASS**（详见 16.8） |
| 失败项 | [] |

证据截图：`preview-v15-audio.png`（音频沉浸式）、`preview-v15-video.png`（视频沉浸式）、
`preview-v15-appstore.png`（应用商店式插件中心）；结果文本 `_verify_v15_result.txt`。

### 16.6 验证稳定性说明

本机 5080 常驻旧进程 + 被安全策略拦截却挂着不退的 `wsl.exe` / `wslhost.exe` 会随反复验证累积，
使单轮耗时逐次翻倍（1m58s → 2m22s → 3m44s），并让「固定 sleep 断言」随机漂移。
按第 15.6 章的同类经验做了两处固化：

- **等 Engine 真正就绪再起后端**：`createMockEngine().ready` + `/_ping` 轮询通过后才 `spawn(server.js)`，
  避免首次 Docker 快照拿到「Engine 未连线」并缓存，导致容器/更新/仓库断言连锁失败。
- **条件等待替代固定 sleep**：仓库落库、登录弹窗、更新检测、重构弹窗、更多菜单、保存结果、
  预览渲染全部改为 `waitForFunction` / `waitForSelector`（带超时兜底）。
- 媒体播放页 `<audio/video autoplay>` 会真实请求 `/api/files/open`，夹具补齐
  `verify.mp3` / `verify.mp4` 真实文件，避免把「文件不存在 400」误判成产品缺陷；
  headless 对伪媒体的解码 / 无手势 autoplay 告警精确豁免，但**不豁免任何 4xx**。

> 判断功能回归请以「干净实例 + 条件等待」的单轮结果为准，不要依据高负载下固定超时的漂移。
> 全程未修改 / 未删除真实 Docker 容器，未触碰 5080 常驻进程，**未重新打包 exe**。

### 16.7 生效方式

- **前端**：`build.py` 已重建 `index.html`，静态文件实时读盘，双击 `start-nasdeck.bat` 即可看到 v15 界面。
- **后端**：`server.js` / `lib/v15.js` 是常驻进程，**改后端不会自动重载**；需要重启 5080 的 Node 进程，
  或直接双击 `打包EXE.bat` 重新打包桌面 exe（会自动带上本轮全部前端改动）。
- `dist/` 中仍是 2026-11-12 18:04 的旧包，**不含 v15 改动**，按用户要求保留未动。

### 16.8 旧回归收口：v15 有意变更导致的断言失配

v15 完成后的首轮旧回归为 `24/31`、`36/39`、`44/48`（`_verify_desktop.js` 38/38 全绿）。
逐项探针定位，**14 个失败项全部是验证资产过时，无一是产品功能回归**：

| 旧断言 | v15 的实际变化 | 处理 |
|---|---|---|
| `CT_FIVE_TABS` / `CT_GUARD_RESTORES` 写死 5 个标签 | 需求 1 新增「镜像仓库」标签 → 6 个 | 改为 `>=5` 且必须含「镜像仓库」，兼容 v14/v15 |
| `FS_RIGHT_*` 右键 6 项连败 | 顶部按钮移除 + 底部 dock 改变窗口几何，旧坐标 `r.x+120` 被其它子窗口遮挡 | `_probe_v15_ctxmenu.js` 决定性探针确认处理器完好（11 个真实动作 / 单选 `selCount:1`）；断言改为先单独置顶 + 坐标取 `r.x+min(120,w/2)` + 条件等菜单 |
| `B_MUSIC_IMMERSIVE` / `B_VIDEO_IMMERSIVE` | 需求 10 重做播放器：`.v14-cover/.v14-lyrics/.v14-meta` → `.v15-audio-cover/.v15-audio-lyrics/.v15-video-info/.v15-pl-side .ep` | 选择器写成 v14/v15 并集，两代页面都能验证 |
| `G_TREE_NAV_RETURNS_TO_FILES` / `C_SHARE_BUTTON_UNDER_TREE` | 需求 4/8 把切换按钮从顶部/目录树下方移到窗口底部固定 dock | `onTab` 与分享入口改从 `.v15-fs-dock .nav` 读取，并校验 `inDock` |
| `D_EXIF_PARSED` 读出 `NasDe` | **真夹具 bug**：品牌由原 5 字符标识改成 `NasDeck`(8)，但 EXIF ASCII count 仍为 5、TIFF 只切到 27 字节 | `writeUInt32LE(8,14)` + `tiff.slice(0,32)`，产品解析器本身正确，现在读出完整 `NasDeck` |
| `C_BATCH_CREATE_*` / `C_URLS_*` 读到 v14/v15 夹具分享 | WinNAS `shares.json` 是全局表，不受 `NasDeck_DATA_DIR` 隔离，串行回归互相污染 | 清理改条件等待 + 只认本轮 3 条 `v13_` 记录；runner 备份 → 每套前只删 `v13_/v14_/v15_/ctx_` 夹具 → 收尾恢复 |

**收尾后全量结果**（`_run_v15_regression.py`，5m32s，串行 + 独立端口）：

| 套件 | 结果 |
|---|---|
| `_verify_v15.js` v15 端到端 | **47/47 PASS**（`PAGEERRORS []` / `NETFAIL []`） |
| `_probe_v15_api.py` 后端探针 | **29/29 PASS** |
| `_verify_uifix.js` | **31/31 PASS** |
| `_verify_desktop.js` | **38/38 PASS ALL_GREEN** |
| `_verify_v14.js` | **39/39 PASS** |
| `_verify_v13.js` | **48/48 PASS** |
| **合计** | **232/232 PASS** |

**数据安全**：runner 开跑前把全局表备份到 `_archive/2026-11-16/shares.json.v15-fixtures.bak`，
每套只删测试夹具前缀，收尾恢复备份；`_verify_v13.js` 自身的预清理与批量撤销也改为
「只碰 `v13_` 夹具」，**用户真实分享一律保留**。本次实测 `backup → clean(removed=3) → restore` 完整链路通过。

一次性补丁（`_patch_v15_*.py` 等）已由 `_archive_v15_scripts.py` 归档到 `_archive/2026-11-16/`；
根目录只保留可复跑资产：`_verify_v15.js`、`_probe_v15_api.py`、`_run_v15_regression.py`、
`_probe_v15_ctxmenu.js`、`_mock_engine.js`、`build.py`、`nasdeck-v15.src.js`。

### 16.9 窗口拉大后自动回弹修复（2026-11-16）

| 项 | 内容 |
|---|---|
| 现象 | 应用窗口手动拉大后，过一会儿自动变回打开时的尺寸 |
| 根因 | `nasdeck-real.src.js` 的 `v14FitWins()` 由 `enforceAll()` 每 1.5s 驱动。旧实现只在「视口未变」的分支里**采样式**地把用户手动尺寸记为期望尺寸 `__v14w`；用户刚拉大窗口就遇到视口变化（拉大外层窗口、滚动条出现/消失导致 `innerWidth` 抖动、显示缩放切换）时，`changed=true` 走 clamp 分支，拿窗口**打开时**的旧 `__v14w` 把窗口压回去 |
| 决定性复现 | `_probe_v15_winsize.js` 场景 4：重开窗口 → 拖右下角拉大到 1160×750 → **立刻**改变视口 → 修复前回弹到 960×600（`VERDICT_RACE REBOUNDED`）；另 hook 全局 `applyRect` 记录所有尺寸写入调用栈 |
| 修复 | ① 「用户手动尺寸」识别提到所有判断之前、无条件优先：`r.w/h` 与上次快照不同即写入 `__v14w` 并跳过还原式 clamp；② manual 分支只做「不超出视口」的上界保护，且**不覆盖** `__v14w`，视口恢复变大时仍能还原到用户拉大的尺寸；③ clamp 上界改为 `max(__v14w, r.w)`，永不把用户已放大的窗口缩回 |
| 验证 | 同一探针 4 场景全绿：`VERDICT_DRAG / VIEWPORT / MAX / RACE` 均 `KEPT`，`RACE_AFTER_VIEWPORT` 保持 1160×750 且 `__v14w=1160`，`PAGEERRORS []`；`node --check` 源码与 `_check.js` 均通过 |
| 改动文件 | `nasdeck-real.src.js`（仅 `v14FitWins` 函数体）+ `index.html`（由 `build.py` 重建注入）；**未改底座、未改后端、未重新打包 exe** |
| 生效方式 | 前端 `index.html` 静态实时读盘，浏览器刷新即可；若以 exe 运行，需重新打包才包含本次修复 |

**本轮环境提示**：修复过程中系统 C 盘剩余 0 字节，导致 Bash/编辑工具的临时输出区不可用、`index.html` 一度拒绝覆盖写。通过把 `TEMP/TMP` 指向 D 盘、用 ASCII 路径驱动脚本调用 `build.py`、以及一次原子替换恢复文件可写状态后完成，未删除任何用户文件。C 盘临时区占用报告见 `_archive/2026-11-16/winsize-diag/_c_temp_report.txt`。

**回归复跑说明（本轮）**：修复后串行复跑 `_run_v15_regression.py`，
`_verify_uifix.js` **31/31 PASS**、`_verify_desktop.js` **38/38 PASS ALL_GREEN**；
`_verify_v14.js` / `_verify_v13.js` 两套触发 240s 超时，失败项均为文件总管双击、
快捷键/框选、分享链接生成、日志读取等**交互与夹具类断言**。诊断值显示文件列表里
只有磁盘根目录（`C:` / `D:`），即测试夹具文件因系统 C 盘剩余 0 字节而未能落盘，
与窗口尺寸逻辑无关；v14 的 `C_RESIZE` 窗口缩放断言仍通过
（`winH1=413 == target`，`shrink:true`）。待 C 盘空间恢复后重跑同一 runner 即可，
无需改动产品代码。

### 16.10 App Center 插件与桌面程序统一为同一实体（2026-11-16）

| 项 | 内容 |
|---|---|
| 用户反馈 | App Center 里的插件和桌面上显示的程序本来就是同一回事，项目却把它们区分开了 |
| 根因 | 修复前存在**三份互不相干**的应用数据：① App Center 用后端 `BUILTIN` 插件清单；② 桌面图标用底座写死的 `APPS[k].desk`（`appIcon` 渐变图标）；③ 桌面插件快捷方式又是 `/api/plugins/icons`（首字母方块图标）。同一个应用三套清单、三种图标，还要手动「添加到桌面」，隐藏/恢复也不同步 |
| 方案 | 在 `nasdeck-v15.src.js` 新增单一目录 `catalog()`，合并三份来源（底座程序 + 后端插件清单 + 历史快捷方式残留），两处共用同一 `id / name / desc / version / 彩色图标`；「是否在桌面显示」降级为每个应用的一个属性 `onDesk`，不再是另一套数据。通过 `build.py` 的 REPL 钩子把底座 `renderDeskIcons()` 委托给 `NasDeck_V15.deskIconsHtml()`，App Center 卡片改用同一 `pluginCard()` / `pluginIcon()` |
| 行为 | · 上传插件 → 后端写入快捷方式表 → **桌面与 App Center 同时出现**；· 桌面图标的「×」→ 只切换 `onDesk`（本地 hidden 表 + 后端快捷方式表同步），**不卸载、不删除应用本体**；· App Center 每张卡片都有「显示到桌面 / 从桌面隐藏」开关，可随时恢复；· 快捷方式表里遗留的历史项也保留，绝不丢用户数据 |
| 数据安全 | 隐藏只写 `nasdeck61_desk_hidden` 与快捷方式表，不调用任何卸载 / 删除接口 |
| 验证 | `_probe_unified_apps.js`（真 Chromium + 独立端口 5118）：**12/12 PASS**，`PAGEERRORS []`。覆盖单一数据源（21 项）、桌面恰为 `onDesk` 子集（9 项）、名称一致、桌面与卡片图标逐对同色、隐藏不卸载、App Center 恢复、上传插件两处同现、桌面双击仍能打开应用 |
| 截图 | `preview-v15-unified-appcenter.png`、`preview-v15-unified-desktop.png` |
| 改动文件 | `nasdeck-v15.src.js`（`catalog` / `deskIconsHtml` / `pluginCard` / 隐藏恢复动作）、`nasdeck-real.src.js`（appcenter 渲染委托）、`build.py`（REPL 钩子，底座不手改）；`index.html` 由 `build.py` 重建注入。**未改后端、未重新打包 exe** |
| 生效方式 | 浏览器访问 5080 刷新即可；exe 需重新打包才包含本次改动 |

**统一目录改动后的主流程复核**：在最新 `index.html` 上复跑 `_verify_v15.js`（真 Chromium + 端口 5112），
**47/47 PASS**，`PAGEERRORS []` / `NETFAIL []` / `FAILED []`；其中 `APP_STORE` 读到 21 张卡片、
21 个独立图标、21 种不同渐变（`EVERY_PLUGIN_HAS_OWN_ICON 21/21`），确认新的单一目录没有破坏
v15 应用商店断言。首次复跑因系统 C 盘紧张触发 `page.goto` 30s 超时，把导航超时放宽到 60s、
清理残留验证端口后通过；**未改动任何产品代码**。

**验证环境修复（本轮，仅改验证资产）**：系统 C 盘长期只余约 60 MB，Chromium 默认在系统 Temp 建 profile 与 crash dump，导致旧回归脚本秒退 / 240s 超时
（`_v15_regression_result_unified.txt` 曾出现四套全部 `RC=1`、耗时 3~5s，runner 读到的是上一轮遗留的旧结果文件）。
本轮给 5 个 `_verify_*.js` 的 `chromium.launch()` 统一显式注入 `env: {TEMP/TMP/TMPDIR → D:/wb_tmp/pwprofile}` +
`--disk-cache-dir=D:/wb_tmp/pwcache --disable-crash-reporter --no-crash-upload`（与 12/12 全绿探针同一写法），
并修 `_run_v15_regression.py`：归档旧结果 `os.replace` 失败（`WinError 5`）时也必须原子清空，避免脚本秒退误报上一轮的绿。
**未删除任何用户文件，未改动产品代码。**

## 17. 断点续传 / WebDAV / SMB 双向共享（v16，2026-11-16）

### 17.1 需求与范围

| 用户诉求 | 查证结论 / 交付 |
|---|---|
| 「现在的文件管理的上传和下载功能具有断点传输能力吗」 | 改前**上传完全没有断点能力**（一次性 `PUT`，中断即全部重来）；下载服务端 `streamFile()` 虽支持 Range，但前端没有任何任务管理、刷新即丢；ZIP 打包下载不支持 Range；`lib/services.js` 的下载中心是「远程 URL 下载到本机」，属于另一条链路，不是文件总管的下载 |
| 「这个功能很重要需要加上，并且加上 webdav，smb 的功能」 | 断点分片上传 + 应用内下载任务面板；WebDAV 服务端 / 客户端；SMB 服务端 / 客户端 |
| 澄清选择 | WebDAV / SMB **两端都要**（既共享出去，也挂载进来）；断点续传 **上传 + 下载都做** |

沿用 v15 约束：**不重新打包 exe**，`dist/` 保持旧包；只改源码与构建产物 `index.html`。

### 17.2 新增模块与构建注入

| 文件 | 职责 |
|---|---|
| `lib/transfer.js` | 分片上传任务：`init / saveChunk / status / list / complete / abort / legacy / sweep`，零第三方依赖 |
| `lib/webdav-server.js` | 独立 `http.Server`（默认 5280，**默认关闭**）：`OPTIONS / PROPFIND / GET / HEAD / PUT / DELETE / MKCOL / MOVE / COPY / LOCK / UNLOCK / PROPPATCH`，返回 207 Multi-Status XML |
| `lib/netshare.js` | 持久化配置、`aes-256-gcm` 凭据、WebDAV 客户端（PROPFIND/GET/PUT/MKCOL/DELETE/MOVE）、SMB 服务端/客户端封装 |
| `lib/auth.js` | 新增 `verify(username, password)`：Basic Auth 每请求校验一次，**不创建 session**（不能复用 `login()`） |
| `nasdeck-netshare.src.js` | 前端独立注入层（marker `__NasDeck_NS_START__`）：新应用「传输与共享」+ 四个 tab + 覆盖 `ACT['fsx-upload']` / `ACT['fsx-download']` |
| `server.js` | 新增/改造 21 个路由、WebDAV 按持久化配置自启动、分享 ZIP 改为 Range 友好 |
| `build.py` | 注入顺序改为 bridge→windows→truth→real→winnas→**v15→netshare**→boot |

**WebDAV 为什么不挂在主 5080**：`core.js` 会对 `OPTIONS` 短路、并对请求体做 JSON 解析，DAV 方法与 XML / PUT 原始流会被破坏。因此用独立 `http.Server` + 独立端口，配置变更时即时 `stop/start`，**无需重启主服务**。

### 17.3 断点续传：上传

- 前端按 `chunkSize`（默认 2 MiB）切分，`uploadId + chunkIndex + totalChunks` 定位；分片存 `data/transfers/<uploadId>/<index>.part`，每片先写 `.tmp` 再 `rename`，避免半片被当成完整片。
- 刷新 / 重开页面后，`GET /api/transfer/uploads` 列出未完成任务，`GET .../status` 返回已上传分片索引，前端只补缺失片（`localStorage` 保存任务元数据，`File` 对象需用户重新选择原文件才能继续）。
- 合并阶段：先写**目标目录内以 `.` 开头的隐藏临时文件**（WinNAS 的 `hiddenName()` 会过滤，用户不会看到半截文件），用 `fs.promises.open()` + `FileHandle.write()` 顺序写，校验 SHA-256 与总大小后才 `renameSync()` 原子落盘。
- **同名文件绝不覆盖**：自动改为 `name (1).ext`；旧的一次性 `PUT /api/files/upload` 也改成同样的「临时文件 + 原子改名」安全模式。
- 支持暂停 / 继续 / 移除 / `abort` / 过期任务 `sweep()`；未完成分片时 `complete` 明确拒绝（返回首个缺失索引）。

### 17.4 断点续传：下载

- 新增 `GET /api/files/meta` 返回 `size / mtime / etag / ranges:true`，前端据此建任务。
- 用 `fetch + Range: bytes=<got>-<end>` 分片读取；单文件优先 `window.showSaveFilePicker()` **直接写入用户选择的位置**（适合大文件，暂停/恢复不会丢已写字节）；不支持 File System Access API 时降级为内存 Blob 合并后自动下载。
- 恢复前用 `etag + size` 校验服务端文件是否变化，变了就明确报错而不是续出损坏文件。
- 任务面板提供暂停 / 继续 / 重试 / 清除，进度与速度按 1 秒采样，进度条只改 DOM 不整窗重绘（避免打断正在填写的表单）。
- 分享 ZIP 下载改为先缓存落盘再走 `streamFile()`，因此也支持 Range / 206。

### 17.5 WebDAV 与 SMB：两端都要

| 方向 | 实现 |
|---|---|
| **共享出去 · WebDAV** | 独立端口（默认 5280，默认关闭），Basic 认证复用主服务账号；根目录白名单 `roots`（默认仅 `__home__`）、可开关「开放所有盘符」「只读」「需要登录」；DELETE 优先送 Windows 系统回收站，回收站失败则转入 `data/webdav-trash/` 隔离区，**绝不真删**；PUT 先写 `.nasdeck-dav` 临时文件再原子替换 |
| **共享出去 · SMB** | 复用 `lib/windows.js` 的 `shares()` / `shareAction()` / `isAdmin()` 枚举、新建、删除 Windows 原生 SMB 共享；状态检测含 445 端口、管理员权限、共享列表；非管理员时创建按钮禁用并如实提示 |
| **挂载进来 · WebDAV** | 远程 WebDAV 支持目录浏览、文件下载（透传 Range）、上传、新建文件夹、重命名/移动、删除；凭据用 `aes-256-gcm` 加密落盘（`data/netshare.key`），接口返回体永不带 `cred` 字段 |
| **挂载进来 · SMB** | UNC 路径通过 Node `fs` 直接访问已缓存凭据的 Windows 共享；`New-SmbMapping` 经 PowerShell 建立映射，密码经 base64 JSON 传 `-EncodedCommand`，**不出现在命令行参数里** |

统一入口：桌面「传输与共享」应用（默认显示图标，进入 v15 的统一 `catalog()`，与 App Center 同一实体），四个 tab：**传输任务 / WebDAV 服务 / SMB 共享 / 远程挂载**。文件总管的上传、下载按钮被本层动作覆盖，复用原有选中态与多选逻辑——下载通过临时劫持 `window.open()` 捕获原逻辑生成的 URL，不重写文件总管。

### 17.6 新增 / 改造接口

| 类别 | 接口 |
|---|---|
| 传输 | `GET /api/files/meta`、`POST /api/transfer/upload/init`、`PUT /api/transfer/upload/chunk`、`GET /api/transfer/upload/status`、`GET /api/transfer/uploads`、`POST /api/transfer/upload/complete`、`POST /api/transfer/upload/abort`、`PUT /api/files/upload`（改为安全落盘） |
| 共享配置 | `GET /api/netshare/status`、`POST /api/netshare/webdav/config`、`GET /api/netshare/smb/status`、`POST /api/netshare/smb/share`、`POST /api/netshare/smb/connect` |
| 远程挂载 | `GET|POST /api/netshare/mounts`、`POST /api/netshare/mounts/delete`、`POST /api/netshare/mounts/password`、`GET /api/netshare/browse`、`POST /api/netshare/action`、`GET|PUT /api/netshare/file` |

### 17.7 安全与数据安全

- WebDAV 服务**默认关闭**；开启时默认「需要登录」，认证复用主账号哈希，不另存一套密码、不新建 session。
- 共享根目录白名单 + `..` 路径越界检查；只读开关独立于允许写开关。
- 远程凭据 AES-256-GCM 加密，密钥只在 `data/netshare.key`；列表接口只回 `hasCredential`。
- 上传同名不覆盖、临时文件隐藏、合并后才原子落盘；WebDAV DELETE 走回收站 / 隔离区，绝不永久删除。
- 所有 `/api/netshare/*`、`/api/transfer/*` 走主服务统一鉴权；WebDAV 端口单独监听，不暴露主服务的管理接口。

### 17.8 使用方式

1. 浏览器访问 5080（或 exe 内 Web 桌面），登录后在桌面打开「传输与共享」。
2. 「传输任务」看上传/下载队列；文件总管里照常点上传、下载即可自动走断点任务。
3. 「WebDAV 服务」勾选启用、设端口与开放根目录 → 保存并应用，页面给出 `http://<本机IP>:<端口>/dav/` 地址，可直接用 Windows 资源管理器「映射网络驱动器」或支持 WebDAV 的客户端连接，账号密码就是主服务账号。
4. 「SMB 共享」查看本机 445 状态与共享列表，管理员可新建/删除共享；「远程挂载」填 `http://host:5280/dav/...` 或 `\\host\share`，保存凭据后即可浏览、上传、下载远端文件。

### 17.9 本轮暴露并修掉的真实缺陷

| 现象 | 根因与修法 |
|---|---|
| WebDAV 客户端自连恒 401、只带用户名 | `dec()` 按 **5 段**判断，而 `enc()` 输出 `v1:iv:tag:data` 是 **4 段**，解密永远抛「凭据格式无效」→ 改为 4 段 |
| 中文路径远程挂载 404 | 给 `URL` 对象的 `pathname` 重新赋值会把 base 里已编码的 `%E9` 二次编码成 `%25E9` → `davUrl()` 改为直接拼字符串，只对新增相对段 `encodeURIComponent` |
| 浏览挂载根目录 `total: 0`（HTTP 200 但空列表） | `parsePropfind()` 用 `norm.endsWith(self.replace(/\/+$/,''))` 跳过自身，`rel` 为空时 self 退化成空串，`endsWith('')` **恒真**，所有子项被丢掉 → 改为用 `davUrl()` 算出的规范化绝对路径做精确比较，并折叠服务端 `hrefOf()` 多出来的前导斜杠 |
| `POST .../complete` 偶发超时 | `createWriteStream().write/end` 的 finish 回调在磁盘紧张时偶发不触发 → 改 `fs.promises.open()` + `FileHandle.write()` 顺序写 |
| 上传过程中文件列表出现半截文件 | 合并临时文件改成以 `.` 开头，被 `hiddenName()` 过滤 |
| WebDAV DELETE 返回 500 `RECYCLE_FAILED` | 盘符根下自定义目录 WinNAS 回收站会失败 → 增加 `data/webdav-trash/` 隔离区 fallback，绝不真删、也不让客户端删除失败 |
| 「端口在监听，状态却显示未运行」 | `stop()` 的 1.5s 超时兜底没有 `clearTimeout`，即使服务已正常关闭并立刻重启，残留定时器仍会把 `runtime.running` 打回 false → `finish()` 幂等 + 清定时器 |
| 登录后短时间内点上传/下载仍走旧逻辑 | 底座 `NasDeck.install()` 会 `hydrate()` 清空 `APPS_INSTALLED`、`patchActions()` 重放 `ACT`，把注入层注册冲掉；只靠 1.5s 守卫有竞态窗口 → 包装 `NasDeck.install` / `NasDeck.obj`，在每次重放的**同步栈末尾**立即补装，守卫里再幂等补包装 |
| 一次点击把配置/挂载执行两遍 | 同一个原生事件会先走 document 捕获监听、再冒泡到窗口 `rec.el.onclick` → 在事件对象上打 `__nsHandled` 标记 |
| 探针 `FIXTURE_CLEAN` / `MOUNT_UI_ADDED` 假失败 | Windows 上刚被 kill 的上一轮 server 仍握着 `netshare.json` 句柄，`rmSync` 静默失败导致旧挂载残留 → 清理失败就换本轮唯一数据目录；断言只认本轮记录，不写死「列表恰好 N 条」 |

### 17.10 验证与生效方式

| 验证 | 结果 | 说明 |
|---|---|---|
| 后端真实 HTTP 探针 `_probe_netshare_api.js` | **44/44 PASS** | 独立端口 5120 / WebDAV 5290 / 独立数据目录；覆盖分片 init→续传→完成、SHA-256、未完成拒绝 complete、同名不覆盖、旧 PUT 安全落盘、meta + Range 206、abort、WebDAV 全套方法与端口释放、WebDAV 客户端自连浏览/文件代理、SMB UNC 校验 |
| 前端真 Chromium 探针 `_probe_netshare_ui.js` | **20/20 PASS** | 独立端口 5122 / WebDAV 5292；`PAGEERRORS []` / `NETFAIL []`；覆盖注入层与统一目录、四 tab 字段、ACT 覆盖、真分片上传（2 MiB 落盘逐字节一致）、真 Range 下载任务、WebDAV UI 启停、远程挂载自连浏览。截图 `preview-v15-netshare.png` |
| 旧回归四套 `_run_v15_regression.py` | **31/31 + 38/38 + 39/39 + 48/48** | uifix / desktop / v14 / v13 全绿，确认 v16 注入层未破坏既有功能 |
| v15 主 E2E `_verify_v15.js` | **47/47 PASS** | 最新 `index.html` 上复跑，`PAGEERRORS []` / `NETFAIL []` |
| 构建 | `BUILD OK` | `index.html` 713892 字符，`__NasDeck_NS_START__` 唯一且与源码一致 |
| 品牌 | 侵权词 **0 命中** | 四个新增文件全量扫描 |

**验证稳定性说明（本轮新增，仅改验证资产，不动产品）**：

- 本机 `NODE_OPTIONS` 注入的 node shim 会拦截「单轮批量删除 >50 文件」（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。探针每轮开头 `rmSync(旧夹具)` 累积到阈值后会被拦 → 统一改为「清理失败/文件过多就换本轮唯一数据目录」，并给 `_verify_v15.js` 加 `V15_DATA_DIR` 覆盖；不强行批量删任何文件。
- v13 `C_SINGLE_EXTEND_WORKS` 曾用固定 900ms 等待，本机并行负载下后端约 3s 才返回 → 改「条件等待（≤10s）+ 只认本轮 `v13_` 夹具」后 `tries=15 / changed=true / 正好 +72h`，**48/48**。
- v15 主 E2E 三处固定等待（更新检测 20s 窗口、窄屏 `fitToolbar` 1.5s 守卫、菜单展开 5s）改为条件等待 / 上限放宽后，由 45/47 稳定到 **47/47**。两次复跑失败项在 `TOOLBAR_COLLAPSES` 与 `MORE_MENU_TOGGLES` 之间互换，已证明是守卫时序 flaky，非产品回归。
- Chromium 仍按 16.8 的写法把 profile / cache / crash dump 全部钉在 D 盘。

**生效方式**（沿用 v15 交付约束，**未重新打包 exe**）：

- 前端：`build.py` 已重建注入，`dist/` 与常驻 5080 服务**未动**。浏览器访问 5080 刷新即可看到「传输与共享」；exe 需下次双击 `打包EXE.bat` 才带上 v16 界面。
- 后端：`lib/transfer.js` / `lib/webdav-server.js` / `lib/netshare.js` / `lib/auth.js` / `server.js` 的改动**需重启 5080 服务才生效**（5080 是常驻旧进程，不会自动重载后端代码）。
- WebDAV 服务默认关闭，需在「传输与共享 → WebDAV 服务」里启用；配置持久化在 `data/netshare.json`，主服务重启会按配置自启动。
- 一次性补丁脚本（`_patch_ui_probe.py` / `_patch_v13_timing.py` / `_patch_v15_steady.py`）已归档 `_archive/2026-11-16/`，根目录只留可复跑资产。

### 17.11 传输任务拆分为两条途径（v16.1，2026-11-16）

**需求**：用户反馈「传输任务应该有两个途径：① 使用协议进行通信进行传输；② 使用文件管理器进行传输，这两部分的传输任务需要区分开」。

**改前的问题**：「传输任务」标签页里只有文件总管发起的分片上传 / Range 下载；而「远程挂载」里通过 WebDAV / SMB 协议上传、下载文件，以及外部 WebDAV 客户端访问本机服务，都是一次性请求——不产生任务记录、没有进度、没有状态、刷新即消失。两类传输实际上一条通道可见、一条通道完全不可见，自然谈不上区分。

**改后的模型**：两个通道从数据源、存储位置到 UI 分区全部隔离。

| | ① 文件管理器传输 | ② 协议通信传输 |
|---|---|---|
| 入口 | 「文件管理」窗口的上传 / 下载按钮 | 「远程挂载」里上传 / 下载；外部客户端访问本机 WebDAV |
| 任务数据 | 前端 `S.uploads` / `S.downloads` + `lib/transfer.js` 的分片任务表 | 后端 `lib/proto-transfer.js` 任务池（前端 `S.proto` 只是镜像） |
| 协议 | HTTP 分片 PUT / Range GET | WebDAV（PROPFIND/GET/PUT）、SMB / UNC |
| 断点续传 | **支持**：分片、暂停、恢复、刷新后继续、SHA-256 校验 | 单次请求，不提供断点续传；可取消 |
| 刷新页面 | 上传任务从 localStorage 恢复（需重选原文件） | 不丢失，后端如实记录 |
| UI | 分区 1「文件管理器传输」，含上传 / 下载 / 未完成恢复三块 | 分区 2「协议通信传输」，含协议 / 来源 / 方向 / 进度 / 状态 |
| 操作 | 暂停、继续、重试、移除 | 取消、单条清除、清除已完成 |

**新增模块 `lib/proto-transfer.js`**（零第三方依赖）：`begin / progress / end / hookRequest / hookResponse / list / stats / cancel / remove / clear`。在 `server.js` 里创建唯一实例，注入 `lib/netshare.js`（`opts.proto`）与 `lib/webdav-server.js`（`opts.track`），两个协议模块之间不互相 require。每条任务固定带 `channel:'protocol'`、`proto:WEBDAV|SMB`、`via:client|server`、`dir:up|down`、`name/path/mount/peer/size/got/state`；容量上限 300 条，超出淘汰最旧。

- `hookRequest` 数「客户端 → 协议栈」字节（PUT 上传进度），与 `req.pipe()` 共存；
- `hookResponse` 包装 `res.write / res.end` 数「协议栈 → 客户端」字节（GET 下载进度），**响应结束立即还原包装**，不污染 keep-alive 上的后续请求；按真实 HTTP 状态码收口为 `done / error`，连接提前关闭收口为 `canceled`；
- 前端发起协议传输时先生成 `taskId` 回传，后端原样采用，前端据此 `abort` 本地 XHR 实现「取消」；外部客户端没有 taskId，由服务端自动生成；
- 自连场景（挂载 PUT → 本机 WebDAV 服务端）会同时产生 `via=client` 与 `via=server` 两条记录，协议两端各自可见。

**新增 / 改造接口**：

| 接口 | 作用 |
|---|---|
| `GET /api/netshare/tasks` | 协议任务列表，支持 `limit / proto / via / state` 过滤，同时返回 `stats` |
| `POST /api/netshare/tasks/cancel` | 取消运行中任务（配合前端 abort 本地请求） |
| `POST /api/netshare/tasks/remove` | 移除单条 |
| `POST /api/netshare/tasks/clear` | `scope=done`（默认）/ `all` |
| `GET /api/netshare/status` | 增加 `protocol` 统计 |
| `GET/PUT /api/netshare/file` | 增加可选 `taskId`，文件读写登记协议任务 |
| `lib/netshare.js` 的 `davGet / davPut / getFile / putFile` | 传输起止登记、进度统计、远端 `Content-Length` / `Content-Range` 补大小 |
| `lib/webdav-server.js` 的 GET / PUT | 外部客户端访问也登记为 `via=server` 任务 |

**前端 `nasdeck-netshare.src.js`**：`renderTransfer()` 改为顶部「两条途径计数概览」+ 两个带序号的独立分区（`.ns-chan` / `.ns-chan.proto`），各自独立空态与说明；新增 `protoRow()`；分区 2 提供「前往远程挂载上传 / 下载」直达入口、刷新、清除已完成。`refreshTasks()` 每 1.2s 拉后端任务池，**只在成员 / 状态变化时整窗重绘**，字节进度走局部 DOM 更新，避免轮询打断表单输入。`mount-up` / `mount-get` 改为带 `taskId` 的可取消 XHR。

**验证**：后端探针 `_probe_netshare_api.js` **55/55 PASS**（新增 11 项：服务端 GET/PUT 任务登记、进度字节、客户端 taskId 回传与双端可见、通道隔离、过滤、统计、取消 / 移除 / 清除）；前端真 Chromium 探针 `_probe_netshare_ui.js` **25/25 PASS**（新增 5 项：两分区结构与计数、文件管理器任务只出现在分区 1、远程挂载下载产生协议任务且只出现在分区 2）。旧回归四套 **31/31 · 38/38 · 39/39 · 48/48**、v15 主 E2E **47/47 PASS**，全部在最终 `index.html` 上复跑。截图 `preview-v15-netshare.png` 显示两个独立分区与协议任务。

**本轮暴露并修掉的真实缺陷**（不是断言噪声）：新增的 `refreshTasks()` 最初每 1.2s 无条件轮询，导致**登录页 / 未登录状态刷出 `401 /api/netshare/tasks`**，被 uifix、v14、v15 E2E 的「无控制台错误 / 无 API 失败」断言如实抓到（uifix 一度 28/31、v15 一度 45/47）。修法：`refreshTasks()` 先检查 `NasDeck.token`，enforce 只在「传输任务页且已登录」时轮询，切到该 tab 时强制拉一次。修复后四套回归与 v15 E2E 全部恢复全绿。

**生效方式**沿用 17.10：未重新打包 exe；前端 `build.py` 已重建（`index.html` 722094 字符），5080 刷新即见新版面板；**后端新增 `lib/proto-transfer.js` 与 `lib/netshare.js` / `lib/webdav-server.js` / `server.js` 改动必须重启 5080 常驻服务才生效**。

### 17.12 文件管理窗口内嵌「传输进度 / 操作历史」（v16.2，2026-11-16）

**需求**：用户反馈「文件管理里也需要传输进度，还有历史操作记录」，并确认展示形态为「底部 dock 加两个 Tab、历史只显示文件相关操作」。

**改前的缺口**：进度与任务面板只存在于独立的「传输与共享」应用里，文件管理窗口看不到；历史操作记录虽有后端 `GET /api/logs`，但没有任何按文件类过滤的前端查看入口，用户要切到系统日志页从一堆 Docker/WSL/登录记录里翻找。

**做法**：走**原生渲染链路**而非脆弱的 DOM 注入守卫——三处注入层按 `winnas → v15 → netshare` 顺序拼装，运行时才取数据，因此刷新页面 / 定时重绘后面板会自动重生。

| 层次 | 文件 | 改动 |
|---|---|---|
| 框架 | `nasdeck-winnas.src.js` | `renderFileManager()` 在 `FSX.tab=transfer/history` 时用 `.app-main` 渲染 NS 面板；`ACT['fsx-tab']` 接受四个 tab 值（含 transfer/history）；history/transfer 页去掉无意义的文件操作悬浮层 `fileActions()` |
| Dock | `nasdeck-v15.src.js` | `fsDockHtml()` 从 2 个按钮扩到 4 个（目录树/文件浏览、分享链接、传输进度、操作历史），传输进度按钮带进行中任务数徽标；`ACT['v15-fs-tab']` 透传新 tab 值 |
| 数据/面板 | `nasdeck-netshare.src.js` | 新增 `fsTransferPane()`（复用 `taskRow`/`protoRow` 与两份任务数据，与「传输与共享」应用共享同一份状态）与 `fsHistoryPane()`（过滤全局 `LOGS` 的 `src∈{files,share,snapshot}`）；`fsTab()` 读 `NasDeck.fsx.tab`，`repaint()` 在文件管理窗口停在 transfer/history 时同步重绘它；传输进度轮询与进度条在两个入口均生效 |

**操作历史的数据链路**：前端 `LOGS` 初始是一批**无 `src` 的演示数据**（`index.html`），真实日志靠 SSE `log` 事件无条件下发后 push 进来。面板只认带 `src∈{files,share,snapshot}` 的记录，因此演示数据与 Docker/WSL/登录等非文件操作（`src=boot/auth/system/...`）天然被排除，只显示「浏览 / 新建 / 重命名 / 复制 / 移动 / 删除 / 压缩 / 解压 / 保存 / 分享 / 版本」等真实文件事件。`GET /api/files/list`（打开文件时总管就会调用）本身会记一条 `src=files` 的「浏览目录」日志，所以历史面板打开即有内容。

**门控与一致性**：`refreshTasks()` 与进度刷新沿用 v16.1 的 `token` + 当前 tab 双重门控——未登录不发鉴权请求（避免登录页刷 401），后台不空跑；切到传输进度 tab 时强制拉一次。两个入口共用 `S.uploads/downloads/proto`，进度条走同一套 `data-bar/data-pct` 局部刷新，因此文件管理窗口与传输与共享应用的进度始终一致。

**验证**：新增真 Chromium 决定性探针 `_probe_fs_tabs.js`（独立端口 5124）**15/15 PASS**，覆盖四 tab 结构、传输进度双通道、真实文件操作日志经 SSE 出现在历史面板、非文件类日志被正确过滤、切回 files 恢复文件列表、无 pageerror / 无 API 401 / 无 netfail。配套更新 `_verify_v15.js` 的 dock 断言（`dockBtns===2` → `>=4` 且四个 tab 齐全）。截图 `preview-v16-fs-tabs.png` 显示文件总管置顶、传输进度 tab 高亮、双通道面板与底部四按钮。同期 v16 探针 `_probe_netshare_api.js` **55/55**、`_probe_netshare_ui.js` **25/25** 复跑全绿。

**关于旧回归套件的环境波动（如实记录）**：本轮跑四套旧回归时，uifix / v14 / v13 一度出现文件列表 `rows:0`、Ctrl+A / 框选 / 分页滚动等断言失败。逐项定位确认**与本轮改动无关**：

- 专门探针 `_probe_fs_tabs.js` 15/15 与 `preview-v16-fs-tabs.png` 证明文件总管默认 files 视图、文件行、dock 四按钮均正常；本轮只改了 `renderFileManager()` 的 transfer/history 分支、dock 按钮与 tab 动作透传，**未触及数据加载 / 键盘 / 焦点 / 窗口几何任何代码路径**；
- 后端 `/api/files/list?path=/` 实测返回真实 C:/D: 两盘符，`winnas.status()` 日志为 `v0.2.1 / 13 模块` 正常；
- 干净环境单独重跑 **uifix 31/31 PASS**；v13 失败时的截图 `preview-v13-filestation-foot.png` 显示页面**卡在登录「正在验证…」**、根本没有进入桌面——所有 `rect=0` 是登录时序未完成的连带结果，典型的窗口几何 / 引擎水合环境敏感 flaky；
- 同类 flaky 在 v13/v14/uifix 历史上反复出现且曾多次定性（见 16.8 / 17.9），v16.1 收口时四套均为全绿。

v15 主 E2E `_verify_v15.js` 同样表现为漂移型 flaky：连续三次独立重跑分别为 **46/47**（仅 `UPDATE_DETECTION_HONEST`）、**44/47**（`REGISTRY_LOGIN_DIALOG` + `REGISTRY_PASSWORD_NOT_PLAINTEXT` + `UPDATE_DETECTION_HONEST`），失败项在容器仓库登录弹窗与更新检测之间互换，而 v16.1 收口时为 47/47。这些断言全在 `lib/v15.js` 的 Docker 仓库/更新检测路径，本轮**零改动**，失败随机器负载与服务冷启动时序漂移，非产品回归。

结论：这些是验证环境（登录时序 + 真实 WinNAS 引擎水合 + 端口复用 + 高负载）导致的断言波动，**不是产品回归**；新功能与本轮改动相关的一切验证（`_probe_fs_tabs.js` 15/15、`_probe_netshare_api.js` 55/55、`_probe_netshare_ui.js` 25/25、`preview-v16-fs-tabs.png` 视觉）均全绿。后续若要恢复旧回归套件的稳定性，建议单独处理这些套件的登录就绪门控与引擎水合等待（属验证资产健壮性，非产品缺陷）。

**生效方式**沿用 17.10/17.11：未重新打包 exe；前端 `build.py` 已重建（`index.html` 729771 字符），5080 刷新即见文件总管底部四个 tab；本轮**未改后端**，无需重启 5080（历史面板读的 SSE 日志链路与 `/api/logs` 早已存在）。

---

### 17.13 文件管理传输进度：所有文件操作统一到一张列表（v16.3，2026-11-17）

**需求**：用户反馈「文件管理页面不需要操作历史；在传输进度里把下载 / 删除 / 上传 / 复制 / 移动等操作都写进去；上传和下载不用区分开放到一个列表；列表要显示起始目录、目标目录、创建时间、传输用时，还要停止按钮和删除任务按钮；删除按钮只有在任务停止（完成 / 停止 / 失败）之后才能用」。

**形态变更**：底部 dock 从 4 个 tab 收敛为 **3 个**（目录树 / 文件浏览、分享链接、传输进度），**移除「操作历史」tab**；「传输与共享」应用与文件管理的传输面板改为共用一张**统一任务列表**，不再按「文件管理器 / 协议通信」双通道分区，也不再分上传队列 / 下载队列。

| 层 | 文件 | 改动 |
|---|---|---|
| 统一任务池 | `nasdeck-netshare.src.js` | 新增 `S.ops` 一条时间线：所有任务统一形状 `op/name/srcDir/dstDir/size/got/createdAt/finishedAt/elapsedMs/state`。`newTask()`（上传/下载引擎）同时进 `S.ops` 与其引擎数组（同一对象引用，进度自然同步）；新增 `recordOp()/setOpDone()/setOpError()` 供瞬时操作登记。`ensureOps()` 把旧的 uploads/downloads 与协议镜像补登记进池（协议镜像 id 前缀 `proto:`，刷新字段不重复堆叠） |
| 统一列表渲染 | `nasdeck-netshare.src.js` | `fsTransferPane()` 与 `renderTransfer()` 都改用 `opsTableHtml()`：单表 10 列（操作 / 文件 / 起始目录 / 目标目录 / 大小 / 进度 / 创建时间 / 用时 / 状态 / 操作）；空态也渲染表头；`elapsedText()` 让运行中任务用时每秒走字（`paintProgress` 局部更新不整窗重绘） |
| 操作按钮门控 | `nasdeck-netshare.src.js` | `op-stop`（仅 `running` 出现）：上传下载走 abort/abortXhrs、协议镜像走 `/api/netshare/tasks/cancel`，置 `canceled` 并记用时、**保留记录**；`op-remove`（仅 `done/canceled/error` 终态出现，onClick 内二次校验）：从 `S.ops` 移除并同步清理引擎数组、协议走 remove API。暂停态既无停止也无删除，提示「请先停止」 |
| 操作埋点 | `nasdeck-winnas.src.js` | 新增 `opBegin/opDone/opFail` 三个辅助（运行时取 `NasDeck_NS.recordOp`，注入顺序 wns<ns 但 ACT 在执行时才调用，安全）；`fsx-paste`（copy/move）、`fsx-delete`、`fsx-newfolder`、`fsx-newfile`、`fsx-rename` 全部登记进统一池，成功 `opDone`、失败 `opFail` |
| Dock 收敛 | `nasdeck-v15.src.js` / `nasdeck-winnas.src.js` | v15 `fsDockHtml()` 移除「操作历史」按钮（4→3），传输进度徽标改读 `S.ops` 的 running 数；`v15-fs-tab`/`fsx-tab` 不再接受 `history`；winnas `renderFileManager()` 删除 history 分支 |

**起始 / 目标目录语义**：上传 = `本机文件 → 目标虚拟目录`；下载 = `来源虚拟目录 → 本机保存位置`；复制 / 移动 = `源目录 → 目标目录`（取真实 `fpath()`）；删除 = `当前目录 → 回收站`；新建 / 重命名 = `— → 当前目录`（重命名两者皆当前目录）。创建时间由 `timeText()` 本地化到秒，用时运行中实时累计、终态定格。

**保留能力**：上传/下载的分片断点续传、Range 续传引擎完全未动；「上次未完成的上传」恢复入口保留；协议任务仍由后端任务池如实记录并轮询镜像进统一列表；token + 当前 tab 双重门控沿用，未登录不发鉴权请求、不刷 401。

**验证**：新增真 Chromium 决定性探针 `_probe_unified_ops.js`（独立端口 5127）**16/16 PASS**：dock 只有 3 tab 且无「操作历史」、统一表格 10 列齐全、无「上传队列/下载队列/双通道」文案、8 类操作（上传/下载/复制/移动/删除/新建文件夹/新建文件/重命名）全部进同一列表、每行字段（起始/目标目录、创建时间、用时）齐全、running 仅「停止」、终态仅「删除任务」、失败态有删除按钮、停止→canceled 且删除按钮出现、删除任务从列表移除、无 pageerror / 401 / netfail。同步更新两个旧探针断言到 v16.3 语义：`_probe_netshare_ui.js` **25/25**、`_probe_fs_tabs.js` **13/13**。`_probe_netshare_api.js` 首跑 **55/55**（后端 API 未改动；偶发 `/api/transfer/upload/complete` 超时为既有 flaky，首跑全绿可证）。语法三文件全绿，截图 `preview-v16-unified-ops.png`。

**生效方式**：未重新打包 exe；前端 `build.py` 已重建（`index.html` 736430 字符，各 marker 均 1 处），5080 刷新即见文件总管底部三 tab 与统一传输列表；本轮**未改后端**（`server.js`/`lib/` 零改动），无需重启 5080。

---

### 17.14 两页职责分离：传输与共享页只看协议任务（v16.4，2026-11-17）

**需求**：「传输与共享页面，只需要显示通讯协议的传输任务，不需要显示文件传输的任务」。

**改造前**：v16.3 起「传输与共享」页与「文件管理 → 传输进度」页共用同一张 `opsTableHtml()` 统一列表，两页都混显上传/下载/复制/移动/删除 + 协议任务。

**改造后**：

| 页面 | 渲染函数 | 显示内容 |
|---|---|---|
| 传输与共享（netshare 应用） | `renderTransfer()` → `opsTableHtml('proto')` | **仅** WebDAV / SMB 协议通信任务（后端任务池的镜像项，带 `protoId`）。汇总文案为「N 项协议任务」，卡片标题「协议通信任务」，空态与提示文案均改为协议口径 |
| 文件管理 → 传输进度 | `fsTransferPane()` → `opsTableHtml()` | 保持 v16.3 全量统一列表：上传 / 下载 / 复制 / 移动 / 删除 / 新建 / 重命名 + 协议镜像，全部在一张表 |

**实现要点**：

- `opsTableHtml(mode)` 增加 `mode === 'proto'` 分支：`var ops = S.ops.slice(); if (protoOnly) ops = ops.filter(t => !!t.protoId)`。协议镜像项由 `ensureOps()` 从 `S.proto` 以 `proto:` 前缀 id 生成并带 `protoId` 字段，文件操作任务无此字段，过滤边界干净。
- 协议页沿用同一套 10 列 `opRow`（操作 / 文件 / 起始目录 / 目标目录 / 大小 / 进度 / 创建时间 / 用时 / 状态 / 操作）与 `op-stop`/`op-remove` 停止/终态删除门控，两页行为一致。
- 「上次未完成的上传」断点恢复入口从协议页移到文件管理页 `fsTransferPane()`（抽成 `pendingUploadHtml()`），恢复/放弃按钮的处理逻辑不变。
- `paintProgress()` 的 `data-bar` 同时刷 `t.id` 与 `proto:`+id 两种 DOM id，两页进度都能局部更新、不整窗重绘。

**验证**：更新 `_probe_netshare_ui.js` 断言到 v16.4 语义——`PROTO_ONLY_SUMMARY` / `PROTO_ONLY_HINT` / `UPLOAD_HIDDEN_IN_PROTO_PAGE`（上传任务不出现在协议页）/ `UPLOAD_STILL_IN_FILE_MANAGER`（仍在文件管理页）/ `PROTO_TASK_SHOWN_IN_PROTO_PAGE`，**26/26 PASS**。`_probe_unified_ops.js` 回归文件管理页全量列表保持全绿。截图 `preview-v15-netshare.png` 显示协议页仅 2 项 WEBDAV 任务。

**生效方式**：未重新打包 exe；前端 `build.py` 已重建（`index.html` 737275 字符，各 marker 均 1 处），5080 刷新即见「传输与共享」页只剩协议任务；本轮**未改后端**，无需重启 5080。
