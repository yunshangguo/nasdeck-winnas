# NasDeck WinNAS

> Windows 原生 NAS 风格 Web 桌面。文件始终留在 Windows 本机磁盘，通过网页统一管理与远程访问。

桌面界面只负责可视化 Windows 的一切功能，后端直接跑在 Windows 上，通过 CIM / PowerShell / 性能计数器 / 事件日志采集真实系统状态。后端零第三方运行时依赖（仅 Node 内置模块），文件、回收站、版本快照、压缩、搜索、分享等能力复用 WinNAS 文件引擎，不另造实现。Docker 是其中一个功能，沿用 WSL2 原生 Docker 引擎方案。

---

## 核心能力

界面上的每个 App 对接的都是真实 Windows 能力，不显示演示数据；读不到的数据显示 `N/A` 并说明原因，不填假值。

| 模块 | 对接的真实能力 |
|---|---|
| 控制台 | `Win32_Service`、计划任务、本地用户 / 组，可真实启停服务与执行任务 |
| QuFirewall | `Get-NetFirewallRule`、防火墙配置文件、Defender，可增删规则与快速扫描 |
| 网络与虚拟交换机 | `Get-NetAdapter` / IP / DNS / TCP 连接，展示真实网卡与监听端口 |
| 存储与快照 | 物理盘 / 卷 / SMART / VSS 卷影复制 + WinNAS 文件级版本快照 |
| 资源监控 | CIM 硬件清单（CPU / 主板 / BIOS / 内存条 / GPU / 显示器 / 电池）、磁盘与卷、实时 CPU / 内存 / 网速曲线、进程表，SSE 每 2 秒推送 |
| 系统日志 | 后端日志 + `Get-WinEvent` 系统 / 应用日志 + 监测告警 |
| BackupDeck | `robocopy /E /Z` 真实复制 + `schtasks` 每日排程，默认增量不删目标 |
| App Center | 注册表卸载项 + `winget install/uninstall` 真实安装软件 |
| 容器工作台 | WSL 内 Docker Engine HTTP API，容器 / 镜像 / 卷 / 网络 / 终端 |
| Download Station | HTTP/HTTPS 流式下载、断点续传，aria2 BT / 磁力 |
| 文件总管 | 任意真实 Windows 路径（`/C:/Users/...` → `C:\Users\...`），删除进系统回收站，支持框选 / 快捷键 / 分页 / 分享 |
| 终端机 | 真实 `cmd.exe`，`cd` 保持会话，GBK 自动解码 |
| PhotoDeck / Music / Video | 扫描本机图片 / 音乐 / 视频目录并真实播放 |
| 电源 | 关机 / 重启 / 睡眠 / 锁定 / 注销，60 秒延时可取消，防误触 |

**监测告警**：CPU ≥85% 连续 3 次、内存 ≥90% 连续 2 次、磁盘 ≥90%、温度 ≥80°C 触发，5 分钟冷却；另轮询事件日志、服务状态、网卡掉线与 WSL 引擎连通性。阈值可在「系统日志 → 监测告警」修改。

**真实性保证**：页面加载时清空全部演示数据源，仅用后端真实数据回填；探测不到后端时显示离线状态页而非演示桌面。传感器（温度 / 风扇 / SMART）只有在本机驱动真实暴露时显示读数，否则标注原因。

---

## 运行方式

### 桌面 exe 版（推荐）

直接运行发布目录中的 `NasDeck WinNAS.exe`（目录版）或单文件便携 exe。无需 Node、无需浏览器、无黑色控制台窗口。

打开后是两套独立窗口：

| 窗口 | 内容 |
|---|---|
| 前端页面窗口 | 完整 Web 桌面：启动进度屏 → 登录 → 文件总管 / 存储 / 控制台 / 容器工作台 / 系统启动中心 |
| 后端设置窗口 | 端口 / 绑定地址 / 管理员账号 / 引擎路径 / 数据目录 / WSL Docker / 启动进度 / 控制台日志 / 窗口行为 |

首次运行播种 `admin / admin`，请立即改密码。地址默认 `http://127.0.0.1:5080/`，被占用时自动顺延。关闭前端窗口默认最小化到托盘、后端继续运行，托盘右键「退出」才真正停止。

开发态运行 `npm run desktop`，重新打包运行 `npm run desktop:dist`（或 `desktop:portable` 便携版）。

### Web 后端方式

双击 `start-nasdeck.bat`，首次弹 UAC 提权（服务 / 防火墙 / VSS / 网卡写操作需要管理员权限），后端在当前窗口前台启动并自动打开浏览器。

- 地址：`http://127.0.0.1:5080/`，局域网 `http://<本机IP>:5080/`
- 账号：`admin / admin`，可用环境变量 `NasDeck_USER` / `NasDeck_PASSWORD` 覆盖
- 参数：`--noelev` 不提权、`--nobrowser` 不自动开浏览器、`--check` 只诊断、`--nodocker` 关闭 WSL/Docker 自启
- 直接运行：`npm start`

服务采用分级启动：HTTP 与前端面板先就绪，随后按九个阶段串行初始化环境检查、数据引擎、监测、WMI、回收站、WSL/Docker 与按需服务，浏览器打开即可看到真实进度（`GET /api/boot/status`，免登录）。核心阶段就绪即可进入系统，重功能（全盘索引、媒体扫描、BT、Docker 冷启动）在「系统启动中心」按需触发。

---

## 组件

- **Node.js** ≥ 18（Web 后端方式需要；桌面版自带运行时）
- **Windows** 10 / 11 64 位，管理员权限用于系统级操作
- **WSL2 + Debian/Ubuntu**（容器功能需要，Docker 通过 TCP 2375 暴露）
- **WinNAS 文件引擎**（文件 / 回收站 / 快照等能力的来源，路径在设置窗口配置）
- **aria2**（BT / 磁力下载需要）
- 后端零第三方 npm 依赖，无需 `npm install`

---

## API

主要端点分类：

| 分类 | 端点示例 |
|---|---|
| 登录 | `POST /api/auth/login`、`/api/auth/logout`、`GET /api/auth/session` |
| 水合 | `GET /api/bootstrap`（Windows / WSL / 监测 / 备份 / 媒体快照） |
| Windows 快照 | `GET /api/win/snapshot`、`/api/win/{system\|services\|firewall\|adapters\|storage\|events\|hardware}` |
| Windows 写操作 | `POST /api/win/service`、`/api/win/firewall/rule`、`/api/win/vss/create`、`/api/win/task` |
| 监测 | `GET /api/monitor`、`POST /api/monitor/thresholds` |
| WSL 容器 | `GET /api/wsl/snapshot`、`POST /api/wsl/engine/start`、`/api/wsl/create` |
| WSL 工具 | `GET /api/wsl/distros`、`POST /api/wsl/exec`、`POST /api/wsl/autostart` |
| 硬件 | `GET /api/win/hardware`、`GET /api/win/sensors`（读不到返回 `null` / `supported:false`） |
| 备份 | `GET /api/backups`、`POST /api/backups/{create\|run\|remove\|schedule}` |
| 文件 | `GET /api/files/list?path=/C:/`、`POST /api/files/*` |
| BT | `GET /api/bt/list`、`POST /api/bt/{add\|action\|config}` |

---

## 安全与限制

- 首次运行务必修改默认密码；系统级操作（服务 / 防火墙 / 电源）需要管理员权限。
- 电源操作带 60 秒延时与取消入口；文件删除进系统回收站，可还原。
- 传感器读数依赖本机驱动暴露，不提供时界面明确标注而非伪造。
- Hyper-V 虚拟交换机在家庭版 Windows 上不可用，界面会如实说明。
- RAID 属 NAS 概念，本机方案不提供；卷级 VSS 与文件级版本快照并列展示。
- 云端 DDNS / 中继属于云端专有服务，本项目不伪造相关状态。

---

## 二次开发

前端源码为 `nasdeck-*.src.js`，由 `python build.py`（`npm run build`）注入生成最终 `index.html` 与主脚本，修改前端后需重新构建。后端 API 在 `server.js`，Windows 能力封装在 `lib/`。可用 `npm run check` 做语法检查，`npm run verify*` 系列脚本做功能自检。
