# -*- coding: utf-8 -*-
"""
build.py — 把桥接层 + Windows 界面层 + 真实性守卫层注入 index.html 的主 <script>。
可重复执行（幂等）：先移除旧的注入块，再重新注入并做若干钩子替换。
同时抽取脚本到 _check.js，便于 node --check 做语法校验。
v8 额外注入：分级启动进度屏（内联，页面一打开即渲染）与系统启动中心层。
"""
import os
import pathlib
import re
import sys

D = pathlib.Path(__file__).resolve().parent
HTML = D / 'index.html'
SRC = D / 'nasdeck-bridge.src.js'
CHECK = D / '_check.js'

START = '//__NasDeck_BRIDGE_START__'
END = '//__NasDeck_BRIDGE_END__'
UI_START = '<!--__NasDeck_BOOT_UI_START__-->'
UI_END = '<!--__NasDeck_BOOT_UI_END__-->'
BOOT_DIV = '<div id="boot" class="boot">'

s = HTML.read_text(encoding='utf-8')
bridge = SRC.read_text(encoding='utf-8').strip()
win_src = (D / 'nasdeck-windows.src.js').read_text(encoding='utf-8').strip()
truth_src = (D / 'nasdeck-truth.src.js').read_text(encoding='utf-8').strip()
real_src = (D / 'nasdeck-real.src.js').read_text(encoding='utf-8').strip()
wns_src = (D / 'nasdeck-winnas.src.js').read_text(encoding='utf-8').strip()
bootsrc = (D / 'nasdeck-boot.src.js').read_text(encoding='utf-8').strip()
ui_src = (D / 'nasdeck-boot-ui.src.html').read_text(encoding='utf-8').strip()
v15_src = (D / 'nasdeck-v15.src.js').read_text(encoding='utf-8').strip()
ns_src = (D / 'nasdeck-netshare.src.js').read_text(encoding='utf-8').strip()

if START not in bridge or END not in bridge:
    sys.exit('ERROR: bridge 缺少起止标记')
if 'function NasDeck_WIN_INSTALL' not in win_src:
    sys.exit('ERROR: nasdeck-windows.src.js 缺少 NasDeck_WIN_INSTALL')
if '__NasDeck_TRUTH_START__' not in truth_src or '__NasDeck_TRUTH_END__' not in truth_src:
    sys.exit('ERROR: nasdeck-truth.src.js 缺少起止标记')
if '__NasDeck_REAL_START__' not in real_src or '__NasDeck_REAL_END__' not in real_src:
    sys.exit('ERROR: nasdeck-real.src.js 缺少起止标记')
if '__NasDeck_WINNAS_START__' not in wns_src or '__NasDeck_WINNAS_END__' not in wns_src:
    sys.exit('ERROR: nasdeck-winnas.src.js 缺少起止标记')
if '__NasDeck_BOOT_START__' not in bootsrc or '__NasDeck_BOOT_END__' not in bootsrc:
    sys.exit('ERROR: nasdeck-boot.src.js 缺少起止标记')
if UI_START not in ui_src or UI_END not in ui_src:
    sys.exit('ERROR: nasdeck-boot-ui.src.html 缺少起止标记')
if '__NasDeck_V15_START__' not in v15_src or '__NasDeck_V15_END__' not in v15_src:
    sys.exit('ERROR: nasdeck-v15.src.js 缺少起止标记')
if '__NasDeck_NS_START__' not in ns_src or '__NasDeck_NS_END__' not in ns_src:
    sys.exit('ERROR: nasdeck-netshare.src.js 缺少起止标记')
if BOOT_DIV not in s:
    sys.exit('ERROR: index.html 找不到启动屏 #boot 容器')

# 全部界面层放进桥接块内（END 之前），保证移除/重建幂等
# 顺序：NasDeck 定义 → NasDeck_WIN_INSTALL → truth 守卫 → real 真实机器操作层
#       → winnas 引擎可视化层 → boot 启动中心（只新增 App，不覆盖其它 RENDER）
bridge = bridge.replace(END, win_src + '\n\n' + truth_src + '\n\n' + real_src + '\n\n' + wns_src + '\n\n' + v15_src + '\n\n' + ns_src + '\n\n' + bootsrc + '\n' + END, 1)

# 1) 移除旧桥接块 / 旧启动屏 UI 块并还原启动调用（幂等，可反复构建）
#      UI 块的移除必须把「插入时额外补的那个换行」一起吃掉，否则每构建一次
#      就多一个换行（哈希不一致），也会吃掉 #boot 原有子节点前的缩进。
s = re.sub(re.escape(START) + r'[\s\S]*?' + re.escape(END) + r'\s*', '', s)
s = re.sub(r'\n' + re.escape(UI_START) + r'[\s\S]*?' + re.escape(UI_END), '', s)
# 旧版本构建曾在 UI_END 后多补一个换行；这里归一化，保证底座恢复到原始形态。
s = re.sub(re.escape(BOOT_DIV) + r'\n{2,}(\s*<div class="boot-logo")',
           lambda m: BOOT_DIV + '\n' + m.group(1), s, count=1)
s = s.replace('NasDeck_BOOT();', 'nasdeckInit();')

# 1.2) 注入分级启动进度屏：内联 <script id=...> 带 id 属性，不会被下面的
#      r'<script>' 正则匹配，_check.js 仍然抽取主 <script> 做语法校验。
#      放在 #boot 开标签之后，HTML 解析到这里就立即执行，不用等 37 万字符的主脚本。
#      ui_src 已经 strip()：末尾不带换行，#boot 原有子节点前的换行/缩进原样保留。
s = s.replace(BOOT_DIV, BOOT_DIV + '\n' + ui_src, 1)

# 1.5) 禁止浏览器缓存旧页面（否则改了文件用户仍看到旧的 demo 数据）
CACHE_META = '<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">'
if CACHE_META not in s:
    s = re.sub(r'(<meta\s+charset="[^"]*"\s*/?>)', r'\1\n' + CACHE_META, s, count=1)

# 2) 钩子替换（每一项都是幂等的）
REPL = [
    # v13：底座全局 keydown 直接读 e.target.matches；程序化事件或辅助技术
    # 派发的事件 target 可能是 document（没有 matches），会抛未捕获异常。
    ("document.addEventListener('keydown',e=>{\n if(e.key==='Enter'&&e.target.matches('.modal input'))",
     "document.addEventListener('keydown',e=>{\n if(!e.target||typeof e.target.matches!=='function')return;\n if(e.key==='Enter'&&e.target.matches('.modal input'))"),
    ("$('#lg-go').addEventListener('click',doLogin);",
     "$('#lg-go').addEventListener('click',()=>window.__NasDeck_LOGIN__?window.__NasDeck_LOGIN__():doLogin());"),
    ('请输入密码（演示环境可任意填写）', '请输入密码（默认 admin / admin）'),
    ("$('#lg-forgot').addEventListener('click',()=>toast('密码提示','演示环境：用户名 admin，密码任意填写即可','warn'));",
     "$('#lg-forgot').addEventListener('click',()=>toast('密码提示','真实后端：默认 admin / admin；可用环境变量 NasDeck_PASSWORD 修改','warn'));"),
    ('setInterval(updateMetrics,2000);',
     "setInterval(()=>{if(window.NasDeck&&NasDeck.mode==='live'&&typeof NasDeck.tickMetrics==='function')NasDeck.tickMetrics();},2000);"),
    ('setInterval(updateDL,1700);',
     "setInterval(()=>{if(window.NasDeck&&NasDeck.mode==='live'&&typeof NasDeck.tickDownloads==='function')NasDeck.tickDownloads();},1700);"),
    ('setInterval(updateMusic,1000);', "setInterval(()=>{},1000);"),

    # --- 登录页 / 启动闪屏：静态清除 NasDeck 演示文案，不依赖运行时守卫 ---
    # 用户第一眼看到的就是这一屏；带假型号与"密码任意"会被误认为仍是演示版。
    ('<p>NasDeck 云枢桌面 · 正在启动本机服务</p>',
     '<p>WinNAS 本机版 v2.2.0 · 正在连接 Windows 后端</p>'),
    ('<h1>让数据<span>自由流动</span><br>让管理<span>触手可及</span></h1>',
     '<h1>Windows 本机<span>文件与服务</span><br>网页化<span>统一管理</span></h1>'),
    ('<p class="sub">NasDeck 云枢桌面 · 本机文件与服务<br>文件始终保存在 Windows 本机磁盘。</p>',
     '<p class="sub">NasDeck 云枢桌面 · 底层复用 WinNAS 引擎<br>文件保存在本机磁盘，所有数据由 Windows 实时采集。</p>'),
    ('<div><b>Windows 本机</b><small>DEVICE MODEL</small></div>',
     '<div><b>Windows 本机</b><small>运行平台</small></div>'),
    ('<div><b>NasDeck 2.5.0</b><small>FIRMWARE</small></div>',
     '<div><b>v2.2.0</b><small>后端版本</small></div>'),
    ('<div><b>192.168.1.88</b><small>LAN 1</small></div>',
     '<div><b>127.0.0.1:5080</b><small>本机地址</small></div>'),
    ('<h2>登录 NasDeck</h2>', '<h2>登录本机 NAS 管理台</h2>'),
    ('<p class="lg-sub">请输入系统管理员凭据</p>',
     '<p class="lg-sub">请输入本机后端管理员凭据</p>'),
    ('<div class="lg-tip">演示环境 · 用户名 <b>admin</b>，密码 <b>任意</b> 即可进入</div>',
     '<div class="lg-tip">默认 <b>admin / admin</b> · 可用 NasDeck_PASSWORD 修改</div>'),
    ('<div class="lg-foot"><span>© 2026 NasDeck 云枢桌面</span><span>安全连接 · HTTPS</span></div>',
     '<div class="lg-foot"><span>WinNAS 引擎 · C:\\AI使用\\项目\\NasManager</span><span>本机 HTTP · 请勿暴露公网</span></div>'),
    ("tpush('out','Copyright (c) 2026 NasDeck 云枢桌面 输入 help 查看可用指令。');",
     "tpush('out','Windows 本机真实终端 · 输入 help 查看可用指令。');"),

    # 主菜单底部 / 关于页：连"演示作品"署名与假机型一并静态清掉
    ('<div><b>Windows 本机</b><p>NasDeck 2.5.0 · 4 Bay · 正常运行 26 天 14 小时</p></div>',
     '<div><b>Windows 本机</b><p>NasDeck 云枢桌面 · WinNAS v2.2.0 · 数据实时采集</p></div>'),
    ('<h2>NasDeck 2.5.0</h2><p>Windows 本机 · build 20261105<br>© 2026 NasDeck 云枢桌面 本作品为界面演示。</p>',
     '<h2>Windows 本机 NAS 管理台</h2><p>WinNAS 引擎 v2.2.0 · 文件保存在本机磁盘<br>'
     '所有硬件与监测数据由 Windows 实时采集，读不到显示 N/A。</p>'),

    # --- 子窗口拖动修复 ---
    # .win-sp 是标题栏里 flex:1 占满剩余宽度的空白区，旧条件把它排除，
    # 导致在标题栏中间 / 右侧按下时完全拖不动窗口（用户报「都不能拖动」）。
    # 现在只排除真正的交互元素；按下时给 body 加拖动态，避免 iframe 抢事件。
    (" const bar=e.target.closest('.win-bar');\n if(bar&&!e.target.closest('button')&&!e.target.closest('.win-sp')&&e.button===0){\n  const rec=getWin(bar.dataset.wid);if(rec&&!rec.max){DRAG={t:'move',rec,sx:e.clientX,sy:e.clientY,x:rec.x,y:rec.y}}\n }",
     " const bar=e.target.closest('.win-bar');\n /* 修复：只排除真正的交互元素，不再排除占满标题栏的 .win-sp 空白区 */\n if(bar&&!e.target.closest('button,input,select,textarea,a,[data-no-drag]')&&e.button===0){\n  const rec=getWin(bar.dataset.wid);\n  if(rec&&!rec.max){DRAG={t:'move',rec,sx:e.clientX,sy:e.clientY,x:rec.x,y:rec.y};document.body.classList.add('nasdeck-dragging')}\n }"),
    ("document.addEventListener('mouseup',()=>{if(DRAG){const r=DRAG.rec;if(r.app==='dashboard')refreshDashboardLive();DRAG=null}});",
     "document.addEventListener('mouseup',()=>{document.body.classList.remove('nasdeck-dragging');document.body.classList.remove('nasdeck-resizing');if(DRAG){const r=DRAG.rec;if(r.app==='dashboard')refreshDashboardLive();DRAG=null}});"),
    (".win-sp{flex:1;height:100%;cursor:default}",
     ".win-sp{flex:1;height:100%;cursor:move}.win-bar,.win-title{user-select:none}body.nasdeck-dragging{cursor:move!important}body.nasdeck-dragging iframe{pointer-events:none}"),

    # --- 右键菜单：点完菜单项后必须收起（原来 #ctx 只由 Esc / 外部关闭） ---
    ("document.addEventListener('click',e=>{\n const t=e.target.closest('[data-act]');",
     "document.addEventListener('click',e=>{\n"
     " /* 修复：任何点击都先收起右键菜单，避免点了菜单项后菜单仍浮着 */\n"
     " const _cx=$('#ctx');if(_cx&&!_cx.classList.contains('hidden'))_cx.classList.add('hidden');\n"
     " const t=e.target.closest('[data-act]');"),

    # --- 子窗口 8 方向缩放：原底座只有右下角 16px 手柄，且只支持一种方向 ---
    ("""+'<div class="win-resize" data-wid="'+rec.id+'"></div>';""",
     """+'<div class="win-resize win-rz win-rz-se" data-wid="'+rec.id+'" data-dir="se"></div>'
 +['n','s','e','w','ne','nw','sw'].map(function(d){return '<div class="win-rz win-rz-'+d+'" data-wid="'+rec.id+'" data-dir="'+d+'"></div>';}).join('');"""),
    (""" const rz=e.target.closest('.win-resize');
 if(rz&&e.button===0){const rec=getWin(rz.dataset.wid);if(rec&&!rec.max){DRAG={t:'size',rec,sx:e.clientX,sy:e.clientY,w:rec.w,h:rec.h}}}""",
     """ const rz=e.target.closest('.win-rz');
 if(rz&&e.button===0){const rec=getWin(rz.dataset.wid);if(rec&&!rec.max){DRAG={t:'size',dir:rz.dataset.dir||'se',rec,sx:e.clientX,sy:e.clientY,x:rec.x,y:rec.y,w:rec.w,h:rec.h};document.body.classList.add('nasdeck-resizing')}}"""),
    (""" else{r.w=Math.max(380,Math.min(availW()-r.x-4,DRAG.w+e.clientX-DRAG.sx));r.h=Math.max(260,Math.min(availH()-r.y-4,DRAG.h+e.clientY-DRAG.sy));applyRect(r)}""",
     """ else{const dx=e.clientX-DRAG.sx,dy=e.clientY-DRAG.sy,dir=DRAG.dir||'se';let x=DRAG.x,y=DRAG.y,w=DRAG.w,h=DRAG.h;const MW=380,MH=260,AW=availW(),AH=availH();
 if(dir.indexOf('e')>=0)w=Math.max(MW,Math.min(AW-x-4,DRAG.w+dx));
 if(dir.indexOf('s')>=0)h=Math.max(MH,Math.min(AH-y-4,DRAG.h+dy));
 if(dir.indexOf('w')>=0){const nx=Math.max(0,Math.min(DRAG.x+DRAG.w-MW,DRAG.x+dx));w=DRAG.w+(DRAG.x-nx);x=nx;}
 if(dir.indexOf('n')>=0){const ny=Math.max(0,Math.min(DRAG.y+DRAG.h-MH,DRAG.y+dy));h=DRAG.h+(DRAG.y-ny);y=ny;}
 r.x=x;r.y=y;r.w=w;r.h=h;applyRect(r);}"""),
    # --- v14 需求 7：窗口打开时按当前视口 clamp 尺寸并居中 ---
    #      旧版 usable=Math.max(560,right-118) 会在小屏上把窗口推到视口外，
    #      x 又强制 >=112，宽高超过可视区时工具栏右侧按钮直接被裁掉。
    (" const right=S.widgets?innerWidth-278:innerWidth-16;\n const usable=Math.max(560,right-118);\n const w=Math.min(m.w,usable-8),h=Math.min(m.h,availH()-20);\n const off=(OPEN_COUNT++%6)*20;\n const x=Math.max(112,Math.round(118+(usable-w)/2+off*1.3)),y=Math.max(6,Math.round((availH()-h)/2+off*.55-14));",
     " /* v14 需求 7：按真实视口 clamp 初始宽高并居中，小屏也完整显示所有按钮 */\n"
     " const AW=Math.max(320,innerWidth),AH=Math.max(240,availH());\n"
     " const w=Math.max(300,Math.min(m.w||900,AW-24)),h=Math.max(220,Math.min(m.h||600,AH-16));\n"
     " const off=(OPEN_COUNT++%6)*14;\n"
     " const x=Math.max(4,Math.min(AW-w-4,Math.round((AW-w)/2+off))),y=Math.max(4,Math.min(AH-h-4,Math.round((AH-h)/2+off*.5)));"),

    # v14 需求 7：窗口创建时即记录「期望尺寸」，供 v14FitWins 在视口恢复时还原。
    # 若等到守卫首次运行才记录，用户先缩小视口就会把小尺寸误当成期望值。
    (",prev:null,extra:arg||null};", ",prev:null,extra:arg||null,__v14w:w,__v14h:h};"),

    # --- v14 需求 3：桌面图标允许由 v14 层追加「已安装插件」快捷方式 ---
    (" $('#desk-icons').innerHTML=ids.map(id=>'<div class=\"di\" data-di=\"'+id+'\">'+appIcon(id,46)+'<span>'+esc(APPS[id].name)+'</span></div>').join('');",
     " const _v14x=(window.NasDeck_V14_ICONS&&typeof window.NasDeck_V14_ICONS.html==='function')?window.NasDeck_V14_ICONS.html():'';\n"
     " $('#desk-icons').innerHTML=ids.map(id=>'<div class=\"di\" data-di=\"'+id+'\">'+appIcon(id,46)+'<span>'+esc(APPS[id].name)+'</span></div>').join('')+_v14x;"),

    ("body.nasdeck-dragging{cursor:move!important}body.nasdeck-dragging iframe{pointer-events:none}",
     """body.nasdeck-dragging{cursor:move!important}body.nasdeck-dragging iframe{pointer-events:none}
.win-rz{position:absolute;z-index:9}
.win-rz-n{left:8px;right:8px;top:0;height:5px;cursor:ns-resize}
.win-rz-s{left:8px;right:16px;bottom:0;height:5px;cursor:ns-resize}
.win-rz-w{left:0;top:38px;bottom:16px;width:5px;cursor:ew-resize}
.win-rz-e{right:0;top:38px;bottom:16px;width:5px;cursor:ew-resize}
.win-rz-nw{left:0;top:0;width:10px;height:6px;cursor:nwse-resize}
.win-rz-ne{right:0;top:0;width:6px;height:6px;cursor:nesw-resize}
.win-rz-sw{left:0;bottom:0;width:14px;height:14px;cursor:nesw-resize}
.win-rz-se{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize}
body.nasdeck-resizing{cursor:move!important}
body.nasdeck-resizing iframe{pointer-events:none}
.win.max .win-rz{display:none}"""),

    # --- v15 收尾：App Center 与桌面统一为同一份应用清单 ---
    #      桌面图标不再由 APPS.desk 写死 + 另一套 v14 快捷方式拼接，
    #      改为委托 NasDeck_V15.deskIconsHtml()（与 App Center 同源、同图标）。
    ("function renderDeskIcons(){\n"
     " const ids=Object.keys(APPS).filter(k=>APPS[k].desk);\n"
     " const _v14x=(window.NasDeck_V14_ICONS&&typeof window.NasDeck_V14_ICONS.html==='function')?window.NasDeck_V14_ICONS.html():'';\n"
     " $('#desk-icons').innerHTML=ids.map(id=>'<div class=\"di\" data-di=\"'+id+'\">'+appIcon(id,46)+'<span>'+esc(APPS[id].name)+'</span></div>').join('')+_v14x;\n"
     "}",
     "function renderDeskIcons(){\n"
     " /* 统一清单：桌面 = 应用目录中 onDesk 的项，与 App Center 同源同图标 */\n"
     " if(window.NasDeck_V15&&typeof window.NasDeck_V15.deskIconsHtml==='function'){\n"
     "  const _u=window.NasDeck_V15.deskIconsHtml();\n"
     "  if(typeof _u==='string'){const box=$('#desk-icons');if(box)box.innerHTML=_u;return}\n"
     " }\n"
     " const ids=Object.keys(APPS).filter(k=>APPS[k].desk);\n"
     " const _v14x=(window.NasDeck_V14_ICONS&&typeof window.NasDeck_V14_ICONS.html==='function')?window.NasDeck_V14_ICONS.html():'';\n"
     " $('#desk-icons').innerHTML=ids.map(id=>'<div class=\"di\" data-di=\"'+id+'\">'+appIcon(id,46)+'<span>'+esc(APPS[id].name)+'</span></div>').join('')+_v14x;\n"
     "}"),
]
applied = []
for old, new in REPL:
    if new in s:
        continue                      # 已替换过
    if old not in s:
        print('WARN: 未找到待替换片段 ->', old[:70])
        continue
    s = s.replace(old, new, 1)
    applied.append(old[:48])

# 2.2) 启动屏接管 bootFlow（幂等）
#      原来是固定 1250ms 的假进度条动画；现在由真实 /api/boot/status 决定
#      「何时可以进入系统」，核心阶段就绪即可进，不必等全部功能跑完。
BOOT_FLOW_OLD = "setTimeout(()=>{$('#boot').classList.add('hidden');$('#login').classList.remove('hidden');$('#lg-pass').focus()},1250);"
BOOT_FLOW_NEW = "setTimeout(()=>{if(window.NasDeck_BOOT_UI&&window.NasDeck_BOOT_UI.takeOver){window.NasDeck_BOOT_UI.takeOver();}else{$('#boot').classList.add('hidden');$('#login').classList.remove('hidden');$('#lg-pass').focus();}},260);"
if BOOT_FLOW_NEW in s:
    boot_flow = 'already'
elif BOOT_FLOW_OLD in s:
    s = s.replace(BOOT_FLOW_OLD, BOOT_FLOW_NEW, 1)
    boot_flow = 'patched'
else:
    boot_flow = 'MISSING'
if boot_flow == 'MISSING':
    print('WARN: 未找到 bootFlow 的启动闪屏 setTimeout（启动屏可能无法自动隐藏）')

# 2.5) 数值安全加固（幂等）
#      truth 层会在页面加载时清空 METRIC/DLS/CUR 等 demo 数据源；若 demo 心跳
#      在未登录/未 live 时仍回落运行，就会把 undefined+随机数=NaN 或演示数据
#      重新塞回曲线数组，产生 <path d="MNaN NaN"> 控制台报错、图表空白。
#      这里：① 清理历史版「回落 demo」心跳；② demo 自身 last 兜底；
#            ③ line / dualLine 对非数值、单元素、空数组全部安全。
HARDEN = [
    ("setInterval(()=>(window.NasDeck&&NasDeck.mode==='live'?NasDeck.tickMetrics():updateMetrics()),2000);",
     "setInterval(()=>{if(window.NasDeck&&NasDeck.mode==='live'&&typeof NasDeck.tickMetrics==='function')NasDeck.tickMetrics();},2000);"),
    ("setInterval(()=>(window.NasDeck&&NasDeck.mode==='live'?NasDeck.tickDownloads():updateDL()),1700);",
     "setInterval(()=>{if(window.NasDeck&&NasDeck.mode==='live'&&typeof NasDeck.tickDownloads==='function')NasDeck.tickDownloads();},1700);"),
    ("setInterval(()=>(window.NasDeck&&NasDeck.mode==='live'?null:updateMusic()),1000);",
     "setInterval(()=>{},1000);"),
    ("const last=METRIC[k].at(-1);const d=rnd(-9,9);",
     "const _l=Number(METRIC[k].at(-1));const last=isFinite(_l)?_l:50;const d=rnd(-9,9);"),
    (r"""function line(points,color,fill){const w=300,h=100,max=Math.max(1,...points),step=w/(points.length-1);const d=points.map((v,i)=>(i?'L':'M')+(i*step).toFixed(1)+' '+(h-4-(v/max)*(h-14)).toFixed(1)).join(' ');return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+(fill?'<path d="'+d+' L'+w+' '+h+' L0 '+h+'Z" fill="'+fill+'" opacity=".16"/>':'')+'<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>'}""",
     r"""function line(points,color,fill){const w=300,h=100;const p=(Array.isArray(points)?points:[]).map(v=>{const n=Number(v);return isFinite(n)?n:0});const max=Math.max(1,...p),step=w/Math.max(1,p.length-1);const d=p.map((v,i)=>(i?'L':'M')+(i*step).toFixed(1)+' '+(h-4-(v/max)*(h-14)).toFixed(1)).join(' ')||'M0 '+(h-4).toFixed(1)+' L'+w+' '+(h-4).toFixed(1);return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+(fill?'<path d="'+d+' L'+w+' '+h+' L0 '+h+'Z" fill="'+fill+'" opacity=".16"/>':'')+'<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>'}"""),
    ("const w=300,h=100,mx=Math.max(100,...a,...b),st=w/(a.length-1);",
     "const w=300,h=100,cl=x=>(Array.isArray(x)?x:[]).map(v=>{const n=Number(v);return isFinite(n)?n:0}),A=cl(a),B=cl(b),mx=Math.max(100,...A,...B),st=w/Math.max(1,A.length-1);"),
    ("const path=arr=>arr.map((v,i)=>(i?'L':'M')+(i*st).toFixed(1)+' '+(h-4-(v/mx)*(h-12)).toFixed(1)).join(' ');",
     "const path=arr=>{const p=cl(arr);return p.map((v,i)=>(i?'L':'M')+(i*st).toFixed(1)+' '+(h-4-(v/mx)*(h-12)).toFixed(1)).join(' ')||'M0 '+(h-4).toFixed(1)+' L'+w+' '+(h-4).toFixed(1);};"),
]
hardened = 0
for old, new in HARDEN:
    if old in s:
        s = s.replace(old, new, 1)
        hardened += 1

# 3) 把启动入口 nasdeckInit() 换成 NasDeck_BOOT()，并在其前注入桥接代码
idx = s.rfind('nasdeckInit();')
if idx < 0:
    sys.exit('ERROR: 找不到 nasdeckInit() 启动调用')

# 注意：不要在注入串末尾额外补 \n —— nasdeckInit() 之后原有的换行会保留在 s[idx+...:]，
# 多补一个会让每次构建累积 1 个字符，破坏幂等性。
s = s[:idx] + bridge + '\n\nNasDeck_BOOT();' + s[idx + len('nasdeckInit();'):]
_tmp_html = D / 'index.html.buildtmp'
_tmp_html.write_text(s, encoding='utf-8')
os.replace(str(_tmp_html), str(HTML))

# 4) 抽取 <script> 到 _check.js 供语法校验
m = re.search(r'<script>([\s\S]*?)</script>', s)
if not m:
    sys.exit('ERROR: 找不到主 script 块')
_tmp_js = D / '_check.js.buildtmp'
_tmp_js.write_text(m.group(1), encoding='utf-8')
os.replace(str(_tmp_js), str(CHECK))

print('BUILD OK')
print('  index.html  %d chars' % len(s))
print('  bridge      %d chars' % len(bridge))
print('  truth       %d chars' % len(truth_src))
print('  real        %d chars' % len(real_src))
print('  winnas      %d chars' % len(wns_src))
print('  js          %d chars' % len(m.group(1)))
print('  hooks       %d applied / %d total' % (len(applied), len(REPL)))
print('  bootflow   %s' % boot_flow)
print('  hardened   %d applied / %d total' % (hardened, len(HARDEN)))
print('  markers', {k: s.count(k) for k in
                    [START, END, 'function NasDeck_WIN_INSTALL', '__NasDeck_TRUTH_START__',
                     '__NasDeck_REAL_START__', '__NasDeck_WINNAS_START__', '__NasDeck_BOOT_START__',
                     UI_START, UI_END, 'NasDeck_BOOT();', 'nasdeckInit();', '__NasDeck_V15_START__',
                     '__NasDeck_NS_START__']})
