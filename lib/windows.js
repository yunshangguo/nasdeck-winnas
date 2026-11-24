'use strict';
/* ============================================================
 * windows.js — Windows 原生系统能力层（零第三方依赖）
 *
 * 所有数据通过 PowerShell / CIM / 系统命令真实采集，不编造、不 mock。
 * 采集失败返回空数据 + error 字段；写操作需要管理员时明确报错。
 * 脚本通过 -EncodedCommand (UTF-16LE base64) 传递，规避中文/引号转义问题。
 * ============================================================ */
const cp = require('child_process');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const cache = new Map();
const TTL = { system: 60000, services: 15000, firewall: 20000, shares: 20000, adapters: 15000,
  vss: 30000, events: 20000, tasks: 60000, apps: 300000, processes: 10000,
  connections: 15000, storage: 60000, defender: 60000, users: 300000, perf: 4000,
  hardware: 120000 };

function decode(buf) {
  if (!buf) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  const u = b.toString('utf8');
  if (u.indexOf('\ufffd') >= 0) {
    try { return new TextDecoder('gbk').decode(b); } catch (e) {}
  }
  return u;
}

/* 用 -EncodedCommand 执行 PowerShell，返回原始 stdout */
function ps(script, timeout) {
  return new Promise(resolve => {
    if (!IS_WIN) { resolve({ ok: false, out: '', err: '仅支持 Windows' }); return; }
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    cp.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { timeout: timeout || 45000, maxBuffer: 12 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: decode(stdout).trim(), err: decode(stderr).trim() || (err && err.message) || '' });
      });
  });
}
const HEAD = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference="SilentlyContinue"; $ProgressPreference="SilentlyContinue"; ';

/* 采集：要求脚本最后输出 JSON */
async function psJson(script, timeout) {
  const r = await ps(HEAD + script, timeout);
  if (!r.out) return { ok: false, data: null, err: r.err || 'PowerShell 无输出' };
  try { return { ok: true, data: JSON.parse(r.out), err: '' }; }
  catch (e) { return { ok: false, data: null, err: 'JSON 解析失败: ' + r.out.slice(0, 180) }; }
}
function arr(x) { return Array.isArray(x) ? x : (x && typeof x === 'object' ? [x] : []); }
function q(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
function clean(s, max) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, max || 200); }
function safeId(s) { return /^[A-Za-z0-9._\-\\ :]{1,120}$/.test(String(s || '')); }

function cached(key, fn, force) {
  const now = Date.now();
  const c = cache.get(key);
  if (!force && c && now - c.t < (TTL[key] || 20000)) return Promise.resolve(c.v);
  return fn().then(v => { cache.set(key, { t: now, v }); return v; }).catch(e => ({ error: e.message }));
}
function drop(keys) { for (const k of keys) cache.delete(k); }

/* ------------------------- 只读采集 ------------------------- */

/* 硬件 / 系统总览：一次 CIM 查询拿全 */
function system(force) { return cached('system', async () => {
  const r = await psJson(`
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = @(Get-CimInstance Win32_Processor)
$bios = Get-CimInstance Win32_BIOS
$bb = Get-CimInstance Win32_BaseBoard
$gpu = @(Get-CimInstance Win32_VideoController)
$ram = @(Get-CimInstance Win32_PhysicalMemory)
$pd = @(Get-CimInstance Win32_DiskDrive)
$vol = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3")
$nic = @(Get-CimInstance Win32_NetworkAdapter -Filter "NetEnabled=true")
$obj = [ordered]@{
  hostname=$env:COMPUTERNAME; domain=$cs.Domain; manufacturer=$cs.Manufacturer; model=$cs.Model;
  systemType=$cs.SystemType; osCaption=$os.Caption; osVersion=$os.Version; osBuild=$os.BuildNumber;
  osArch=$os.OSArchitecture; installDate=$os.InstallDate; lastBoot=$os.LastBootUpTime;
  uptimeSec=[math]::Round(((Get-Date)-$os.LastBootUpTime).TotalSeconds,0);
  totalMemGB=[math]::Round($cs.TotalPhysicalMemory/1GB,2);
  cpu=$cpu[0].Name; cpuCores=$cpu[0].NumberOfCores; cpuThreads=$cpu[0].NumberOfLogicalProcessors;
  cpuSocket=$cpu[0].SocketDesignation; cpuMaxGHz=$cpu[0].MaxClockSpeed;
  bios=$bios.SMBIOSBIOSVersion; biosDate=$bios.ReleaseDate; serial=$bios.SerialNumber;
  board=$bb.Manufacturer + ' ' + $bb.Product;
  gpus=@($gpu | % { [ordered]@{ name=$_.Name; driver=$_.DriverVersion; ramGB=[math]::Round($_.AdapterRAM/1GB,2); res=("" + $_.CurrentHorizontalResolution + "x" + $_.CurrentVerticalResolution) } });
  ramSticks=@($ram | % { [ordered]@{ slot=$_.DeviceLocator; capGB=[math]::Round($_.Capacity/1GB,2); speed=$_.Speed; maker=$_.Manufacturer; part=$_.PartNumber } });
  physicalDisks=@($pd | % { [ordered]@{ name=$_.Model; index=$_.Index; sizeGB=[math]::Round($_.Size/1GB,1); interface=$_.InterfaceType; partitions=$_.Partitions; serial=$_.SerialNumber; status=$_.Status } });
  volumes=@($vol | % { [ordered]@{ drive=$_.DeviceID; label=$_.VolumeName; fs=$_.FileSystem; sizeGB=[math]::Round($_.Size/1GB,1); freeGB=[math]::Round($_.FreeSpace/1GB,1) } });
  nics=@($nic | % { [ordered]@{ name=$_.Name; speedMbps=[math]::Round($_.Speed/1MB,0); mac=$_.MACAddress; type=$_.AdapterType } });
  psVersion=$PSVersionTable.PSVersion.ToString();
  isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$obj | ConvertTo-Json -Compress -Depth 6`, 25000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

/* Windows 服务（真实、可启停） */
function services(force) { return cached('services', async () => {
  const r = await psJson(`@(Get-CimInstance Win32_Service | Sort-Object Name | % {
  [ordered]@{ n=$_.Name; d=$_.DisplayName; st=$_.State; start=$_.StartMode; path=$_.PathName;
              user=$_.StartName; pid=$_.ProcessId; desc=$_.Description } }) | ConvertTo-Json -Compress -Depth 3`, 25000);
  return { ok: r.ok, services: arr(r.data).map(x => ({
    n: clean(x.n, 120), d: clean(x.d, 160), st: clean(x.st), start: clean(x.start),
    path: clean(x.path, 260), user: clean(x.user, 100), pid: Number(x.pid || 0), desc: clean(x.desc, 240)
  })), error: r.err };
}, force); }

/* 防火墙：真实规则 + 配置文件状态 */
function firewall(force) { return cached('firewall', async () => {
  const r = await psJson(`
$prof = @(Get-NetFirewallProfile | % { [ordered]@{ name=$_.Name; enabled=$_.Enabled; inbound=$_.DefaultInboundAction; outbound=$_.DefaultOutboundAction } })
$pfMap=@{}; foreach($x in @(Get-NetFirewallPortFilter)){ $pfMap[$x.InstanceID]=$x }
$rules = @(Get-NetFirewallRule -Enabled True | Sort-Object DisplayName | Select-Object -First 100 | % {
  $pf=$pfMap[$_.InstanceID]
  [ordered]@{ n=$_.Name; d=$_.DisplayName; dir=$_.Direction; act=$_.Action; enabled=$_.Enabled;
              profile=$_.Profile; protocol=$(if($pf){$pf.Protocol}else{''}); port=$(if($pf){($pf.LocalPort -join ',')}else{''});
              remote=''; group=$_.DisplayGroup }
})
[ordered]@{ profiles=$prof; rules=$rules; total=@(Get-NetFirewallRule).Count } | ConvertTo-Json -Compress -Depth 5`, 30000);
  const d = r.data || {};
  return { ok: r.ok, profiles: arr(d.profiles), rules: arr(d.rules).map(x => ({
    n: clean(x.n, 120), d: clean(x.d, 140) || clean(x.n, 120), dir: clean(x.dir),
    act: clean(x.act), enabled: !!x.enabled, profile: clean(x.profile), proto: clean(x.protocol),
    port: clean(x.port, 60), remote: clean(x.remote, 60), group: clean(x.group, 80)
  })), total: Number(d.total || 0), error: r.err };
}, force); }

/* SMB 共享 */
function shares(force) { return cached('shares', async () => {
  const r = await psJson(`@(Get-SmbShare | % {
  $ac = @(Get-SmbShareAccess -Name $_.Name | % { [ordered]@{ user=$_.AccountName; right=$_.AccessRight; type=$_.AccessControlType } })
  [ordered]@{ n=$_.Name; path=$_.Path; desc=$_.Description; type=$_.ShareType;
              concurrent=$_.ConcurrentUserLimit; encrypt=$_.EncryptData; access=$ac }
}) | ConvertTo-Json -Compress -Depth 5`, 20000);
  return { ok: r.ok, shares: arr(r.data).map(x => ({
    n: clean(x.n), path: clean(x.path, 260), desc: clean(x.desc, 160), type: clean(x.type),
    concurrent: Number(x.concurrent || 0), encrypt: !!x.encrypt, access: arr(x.access)
  })), error: r.err };
}, force); }

/* 网卡 / IP / 连接速度 / DNS */
function adapters(force) { return cached('adapters', async () => {
  const r = await psJson(`$ipMap=@{}; foreach($x in @(Get-NetIPAddress -AddressFamily IPv4)){ if($ipMap.ContainsKey($x.InterfaceIndex)){ $ipMap[$x.InterfaceIndex]+=','+$x.IPAddress } else { $ipMap[$x.InterfaceIndex]=$x.IPAddress } }
$stMap=@{}; foreach($x in @(Get-NetAdapterStatistics)){ $stMap[$x.Name]=$x }
$dnsMap=@{}; foreach($x in @(Get-DnsClientServerAddress -AddressFamily IPv4)){ $dnsMap[$x.InterfaceIndex]=($x.ServerAddresses -join ',') }
@(Get-NetAdapter | Sort-Object Name | % {
  $a=$_; $st=$stMap[$a.Name];
  [ordered]@{ n=$a.Name; desc=$a.InterfaceDescription; st=$a.Status; speed=$a.LinkSpeed;
              mac=$a.MacAddress; ifIndex=$a.ifIndex; ip=$ipMap[$a.ifIndex]; dns=$dnsMap[$a.ifIndex];
              rx=$(if($st){$st.ReceivedBytes}else{0}); tx=$(if($st){$st.SentBytes}else{0}); vlan=$a.VlanID; virtual=($a.Name -match 'vEthernet|WSL|Hyper-V|Docker') }
}) | ConvertTo-Json -Compress -Depth 4`, 25000);
  return { ok: r.ok, adapters: arr(r.data).map(x => ({
    n: clean(x.n), desc: clean(x.desc, 160), st: clean(x.st), speed: clean(x.speed),
    mac: clean(x.mac), ifIndex: Number(x.ifIndex || 0), ip: clean(x.ip, 80), dns: clean(x.dns, 100),
    rx: Number(x.rx || 0), tx: Number(x.tx || 0), virtual: !!x.virtual
  })), error: r.err };
}, force); }

/* 卷影副本 (VSS) — 真实的 Windows 快照 */
function vss(force) { return cached('vss', async () => {
  const r = await psJson(`
$sc = @(Get-CimInstance Win32_ShadowCopy | Sort-Object InstallDate -Descending | Select-Object -First 40 | % {
  [ordered]@{ id=$_.ID; volume=$_.VolumeName; device=$_.DeviceObject; date=$_.InstallDate;
              state=$_.State; persistent=$_.Persistent; count=$_.Count } })
$st = @(Get-CimInstance Win32_ShadowStorage | % { [ordered]@{ volume=$_.VolumeName; allocGB=[math]::Round($_.AllocatedSpace/1GB,2); usedGB=[math]::Round($_.UsedSpace/1GB,2); maxGB=[math]::Round($_.MaxSpace/1GB,2) } })
[ordered]@{ shadows=$sc; storage=$st } | ConvertTo-Json -Compress -Depth 5`, 20000);
  const d = r.data || {};
  return { ok: r.ok, shadows: arr(d.shadows), storage: arr(d.storage), error: r.err };
}, force); }

/* Windows 事件日志（System + Application） */
function events(force, count) { return cached('events', async () => {
  const n = Math.max(1, Math.min(120, Number(count) || 40));
  const r = await psJson(`$n=${n};
$sys = @(Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2,3} -MaxEvents $n | % {
  [ordered]@{ time=$_.TimeCreated.ToString('yyyy/MM/dd HH:mm:ss'); lv=$(if($_.Level -eq 1){'CRIT'}elseif($_.Level -eq 2){'ERR'}else{'WARN'});
              src=$_.ProviderName; id=$_.Id; msg=($_.Message -replace '\s+',' ').Substring(0,[math]::Min(220,($_.Message -replace '\s+',' ').Length)); log='System' } })
$app = @(Get-WinEvent -FilterHashtable @{LogName='Application'; Level=1,2} -MaxEvents ([math]::Floor($n/2)) | % {
  [ordered]@{ time=$_.TimeCreated.ToString('yyyy/MM/dd HH:mm:ss'); lv=$(if($_.Level -eq 1){'CRIT'}else{'ERR'});
              src=$_.ProviderName; id=$_.Id; msg=($_.Message -replace '\s+',' ').Substring(0,[math]::Min(220,($_.Message -replace '\s+',' ').Length)); log='Application' } })
@($sys + $app) | Sort-Object time -Descending | Select-Object -First $n | ConvertTo-Json -Compress -Depth 4`, 30000);
  return { ok: r.ok, events: arr(r.data).map(x => ({
    time: clean(x.time, 30), lv: clean(x.lv), src: clean(x.src, 80), id: Number(x.id || 0),
    msg: clean(x.msg, 240), log: clean(x.log)
  })), error: r.err };
}, force); }

/* 计划任务 */
function tasks(force) { return cached('tasks', async () => {
  const r = await psJson(`@(Get-ScheduledTask | Sort-Object TaskPath,TaskName | Select-Object -First 80 | % {
  $i = $_ | Get-ScheduledTaskInfo
  [ordered]@{ n=$_.TaskName; path=$_.TaskPath; st=$_.State; author=$_.Author;
              last=$i.LastRunTime; result=$i.LastTaskResult; next=$i.NextRunTime;
              triggers=@($_.Triggers | % { $_.CimClass.CimClassName }) }
}) | ConvertTo-Json -Compress -Depth 4`, 30000);
  return { ok: r.ok, tasks: arr(r.data).map(x => ({
    n: clean(x.n, 120), path: clean(x.path, 160), st: clean(x.st), author: clean(x.author, 80),
    last: clean(x.last, 40), result: Number(x.result || 0), next: clean(x.next, 40),
    triggers: arr(x.triggers).map(clean)
  })), error: r.err };
}, force); }

/* 已安装软件（注册表卸载项，比 winget 快且可靠） */
function apps(force) { return cached('apps', async () => {
  const r = await psJson(`
$paths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
           'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
           'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
@(Get-ItemProperty $paths | ? { $_.DisplayName -and -not $_.SystemComponent } |
  Sort-Object DisplayName -Unique | % { [ordered]@{ n=$_.DisplayName; ver=$_.DisplayVersion;
    pub=$_.Publisher; date=$_.InstallDate; sizeMB=[math]::Round(($_.EstimatedSize/1024),1); key=$_.PSChildName } }) |
  ConvertTo-Json -Compress -Depth 3`, 30000);
  return { ok: r.ok, apps: arr(r.data).map(x => ({
    n: clean(x.n, 160), ver: clean(x.ver, 40), pub: clean(x.pub, 100),
    date: clean(x.date, 20), sizeMB: Number(x.sizeMB || 0), id: clean(x.key, 120)
  })), error: r.err };
}, force); }

/* 进程（真实 CPU 累计 / 工作集 / 路径 / 用户） */
function processes(force) { return cached('processes', async () => {
  const r = await psJson(`@(Get-CimInstance Win32_Process | % {
  [ordered]@{ n=$_.Name; pid=$_.ProcessId; ppid=$_.ParentProcessId; mem=[int64]$_.WorkingSetSize;
              path=$_.ExecutablePath; cmd=$_.CommandLine; threads=$_.ThreadCount; handles=$_.HandleCount }
}) | Sort-Object mem -Descending | Select-Object -First 40 | ConvertTo-Json -Compress -Depth 3`, 25000);
  return { ok: r.ok, processes: arr(r.data).map(x => ({
    n: clean(x.n), pid: Number(x.pid || 0), ppid: Number(x.ppid || 0), mem: Number(x.mem || 0),
    path: clean(x.path, 260), cmd: clean(x.cmd, 260), threads: Number(x.threads || 0)
  })), error: r.err };
}, force); }

/* TCP 监听端口 / 已建立连接 */
function connections(force) { return cached('connections', async () => {
  const r = await psJson(`
$listen = @(Get-NetTCPConnection -State Listen | % {
  $p = Get-Process -Id $_.OwningProcess
  [ordered]@{ addr=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; proc=$p.ProcessName; st='Listen'; remote='' } })
$est = @(Get-NetTCPConnection -State Established | Select-Object -First 40 | % {
  $p = Get-Process -Id $_.OwningProcess
  [ordered]@{ addr=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; proc=$p.ProcessName; st='Established'; remote=($_.RemoteAddress + ':' + $_.RemotePort) } })
[ordered]@{ listen=$listen; established=$est; counts=[ordered]@{ listen=$listen.Count; established=$est.Count } } | ConvertTo-Json -Compress -Depth 4`, 25000);
  const d = r.data || {};
  return { ok: r.ok, listen: arr(d.listen), established: arr(d.established), counts: d.counts || {}, error: r.err };
}, force); }

/* 物理磁盘 / 卷 / SMART 健康（尽力而为） */
function storage(force) { return cached('storage', async () => {
  const r = await psJson(`
$phys = @(Get-PhysicalDisk | % { [ordered]@{ n=$_.FriendlyName; media=$_.MediaType; bus=$_.BusType;
  sizeGB=[math]::Round($_.Size/1GB,1); health=$_.HealthStatus; op=$_.OperationalStatus;
  serial=$_.SerialNumber; spindle=$_.SpindleSpeed } })
$vol = @(Get-Volume | ? { $_.DriveLetter } | % { [ordered]@{ drive=$_.DriveLetter; label=$_.FileSystemLabel;
  fs=$_.FileSystem; health=$_.HealthStatus; sizeGB=[math]::Round($_.Size/1GB,1);
  freeGB=[math]::Round($_.SizeRemaining/1GB,1); type=$_.DriveType } })
$smart = @(Get-CimInstance -Namespace root\\wmi -ClassName MSStorageDriver_FailurePredictStatus | % {
  [ordered]@{ instance=$_.InstanceName; predict=$_.PredictFailure; reason=$_.Reason } })
$part = @(Get-Partition | ? { $_.DriveLetter } | % { [ordered]@{ drive=$_.DriveLetter; disk=$_.DiskNumber;
  offset=$_.Offset; sizeGB=[math]::Round($_.Size/1GB,1); type=$_.Type } })
[ordered]@{ physical=$phys; volumes=$vol; smart=$smart; partitions=$part } | ConvertTo-Json -Compress -Depth 5`, 30000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

/* Defender / 安全中心 / 更新 / 本地用户 */
function defender(force) { return cached('defender', async () => {
  const r = await psJson(`
$d = Get-MpComputerStatus
$t = @(Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5 | % {
  [ordered]@{ n=$_.ThreatID; t=$_.InitialDetectionTime } })
[ordered]@{ av=$d.AntivirusEnabled; realtime=$d.RealTimeProtectionEnabled;
  sig=$d.AntivirusSignatureVersion; sigDate=$d.AntivirusSignatureLastUpdated;
  lastScan=$d.LastQuickScanStartTime; firewall=$d.FirewallEnabled; threats=$t } | ConvertTo-Json -Compress -Depth 4`, 25000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

function users(force) { return cached('users', async () => {
  const r = await psJson(`
$u = @(Get-LocalUser | % { [ordered]@{ n=$_.Name; enabled=$_.Enabled; desc=$_.Description;
  last=$_.LastLogon; pwreq=$_.PasswordRequired } })
$g = @(Get-LocalGroup | % { [ordered]@{ n=$_.Name; desc=$_.Description } })
[ordered]@{ users=$u; groups=$g } | ConvertTo-Json -Compress -Depth 4`, 20000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

/* 性能计数器：比 os 模块更精确的 Windows 原生读数 */
function perf(force) { return cached('perf', async () => {
  const r = await psJson(`
$c = Get-Counter -Counter @('\\Processor(_Total)\% Processor Time','\\Memory\% Committed Bytes In Use',
  '\\Memory\Available MBytes','\\PhysicalDisk(_Total)\% Disk Time','\\System\Processor Queue Length') -SampleInterval 1 -MaxSamples 1
$v = @{}; foreach($s in $c.CounterSamples){ $k=($s.Path -split '\\')[-1]; $v[$k]=[math]::Round($s.CookedValue,2) }
$os = Get-CimInstance Win32_OperatingSystem
[ordered]@{ counters=$v; freePhysMB=[math]::Round($os.FreePhysicalMemory/1024,0);
  totalVisMB=[math]::Round($os.TotalVisibleMemorySize/1024,0); processes=(Get-Process).Count } | ConvertTo-Json -Compress -Depth 4`, 15000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

/* ------------------------------------------------------------
 * 真实硬件清单 + 传感器（CIM / Get-PhysicalDisk / 可靠性计数器）
 * 铁律：读不到就返回 null + supported:false，绝不用占位数值冒充读数。
 * ------------------------------------------------------------ */
function hardware(force) { return cached('hardware', async () => {
  const r = await psJson(`
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$cpus = @(Get-CimInstance Win32_Processor)
$bios = Get-CimInstance Win32_BIOS
$bb   = Get-CimInstance Win32_BaseBoard
$gpu  = @(Get-CimInstance Win32_VideoController)
$ram  = @(Get-CimInstance Win32_PhysicalMemory)
$mon  = @(Get-CimInstance Win32_DesktopMonitor)
$bat  = @(Get-CimInstance Win32_Battery)

$c0 = $cpus[0]
$cpu = [ordered]@{
  name=[string]$c0.Name; maker=[string]$c0.Manufacturer;
  cores=[int]$c0.NumberOfCores; threads=[int]$c0.NumberOfLogicalProcessors;
  socket=[string]$c0.SocketDesignation; maxMHz=[int]$c0.MaxClockSpeed;
  currentMHz=[int]$c0.CurrentClockSpeed; l2KB=[int]$c0.L2CacheSize; l3KB=[int]$c0.L3CacheSize;
  virtualization=[bool]$c0.VirtualizationFirmwareEnabled; loadPct=[int]$c0.LoadPercentage;
  processorId=[string]$c0.ProcessorId; cpuCount=$cpus.Count
}

$memTotal = [math]::Round($cs.TotalPhysicalMemory/1GB,2)
$memFree  = [math]::Round($os.FreePhysicalMemory/1MB,2)
$sticks = @($ram | ForEach-Object { [ordered]@{
  slot=[string]$_.DeviceLocator; bank=[string]$_.BankLabel; capGB=[math]::Round($_.Capacity/1GB,2);
  speed=[int]$_.Speed; configuredMHz=[int]$_.ConfiguredClockSpeed;
  maker=[string]$_.Manufacturer; part=[string]$_.PartNumber; memType=[string]$_.SMBIOSMemoryType
}})
$memory = [ordered]@{ totalGB=$memTotal; freeGB=$memFree;
  usedGB=[math]::Round(($memTotal-$memFree),2);
  pct=$(if($memTotal -gt 0){[math]::Round((($memTotal-$memFree)/$memTotal)*100,1)}else{0});
  sticks=$sticks; stickCount=$sticks.Count }

$board = [ordered]@{ maker=[string]$bb.Manufacturer; product=[string]$bb.Product;
  version=[string]$bb.Version; serial=[string]$bb.SerialNumber }
$biosInfo = [ordered]@{ version=[string]$bios.SMBIOSBIOSVersion; vendor=[string]$bios.Manufacturer;
  date=$(if($bios.ReleaseDate){$bios.ReleaseDate.ToString('yyyy-MM-dd')}else{''});
  serial=[string]$bios.SerialNumber }

$disks = @()
foreach($d in @(Get-PhysicalDisk -ErrorAction SilentlyContinue)){
  $rel = $d | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
  $tc=$null; $tmax=$null; $poh=$null; $re=$null; $we=$null; $wr=$null
  if($rel){
    if($rel.Temperature -gt 0){ $tc=[int]$rel.Temperature }
    if($rel.TemperatureMax -gt 0){ $tmax=[int]$rel.TemperatureMax }
    if($rel.PowerOnHours){ $poh=[int]$rel.PowerOnHours }
    if($null -ne $rel.ReadErrorsTotal){ $re=[int]$rel.ReadErrorsTotal }
    if($null -ne $rel.WriteErrorsTotal){ $we=[int]$rel.WriteErrorsTotal }
    if($null -ne $rel.Wear){ $wr=[int]$rel.Wear }
  }
  $disks += [ordered]@{
    number=[string]$d.DeviceId; model=[string]$d.FriendlyName; serial=[string]$d.SerialNumber;
    firmware=[string]$d.FirmwareVersion; sizeGB=[math]::Round($d.Size/1GB,1);
    media=[string]$d.MediaType; bus=[string]$d.BusType; health=[string]$d.HealthStatus;
    op=[string]$d.OperationalStatus; partitions=$null; spindle=[int]$d.SpindleSpeed;
    tempC=$tc; tempMaxC=$tmax; powerOnHours=$poh; readErrors=$re; writeErrors=$we; wear=$wr;
    reliabilityAvailable=[bool]($null -ne $rel)
  }
}

$vols = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [ordered]@{
  drive=[string]$_.DeviceID; label=[string]$_.VolumeName; fs=[string]$_.FileSystem;
  sizeGB=[math]::Round($_.Size/1GB,1); freeGB=[math]::Round($_.FreeSpace/1GB,1)
}})

$gpus = @($gpu | ForEach-Object { [ordered]@{
  name=[string]$_.Name; driver=[string]$_.DriverVersion; ramGB=[math]::Round($_.AdapterRAM/1GB,2);
  res=("" + $_.CurrentHorizontalResolution + "x" + $_.CurrentVerticalResolution);
  refresh=[int]$_.CurrentRefreshRate; videoProcessor=[string]$_.VideoProcessor
}})

# 网卡链路 / IP / DNS 由 adapters() 统一采集（Get-NetIPConfiguration 单次约 18s，不重复采）
$nics = @()

$mons = @($mon | Where-Object { $_.PNPDeviceID -or $_.MonitorManufacturer } | ForEach-Object {
  [ordered]@{ name=[string]$_.Name; maker=[string]$_.MonitorManufacturer;
    pnp=[string]$_.PNPDeviceID; width=[int]$_.ScreenWidth; height=[int]$_.ScreenHeight } })
$bats = @($bat | ForEach-Object {
  $rt=[int]$_.EstimatedRunTime; if($rt -le 0 -or $rt -gt 100000){ $rt=$null }
  [ordered]@{ name=[string]$_.Name; charge=[int]$_.EstimatedChargeRemaining;
    status=[int]$_.BatteryStatus; runtimeMin=$rt } })

# ---- 传感器：仅采集本机真实暴露的读数 ----
$zones=@()
try{
  foreach($z in @(Get-CimInstance -Namespace root\\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)){
    $v=[math]::Round($z.CurrentTemperature/10-273.15,1)
    if($v -gt 0 -and $v -lt 120){ $zones += [ordered]@{ name=[string]$z.InstanceName; tempC=$v } }
  }
}catch{}
$fans=@(Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ name=[string]$_.Name; rpm=[int]$_.DesiredSpeed } })
$lhm=@()
foreach($ns in @('root\\LibreHardwareMonitor','root\\OpenHardwareMonitor')){
  try{
    foreach($x in @(Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop)){
      $v=$null; try{ $v=[math]::Round([double]$x.Value,1) }catch{}
      $lhm += [ordered]@{ name=[string]$x.Name; type=[string]$x.SensorType; value=$v; source=$ns }
    }
  }catch{}
}
$cpuTemp=$null; $cpuTempSrc=''
foreach($x in $lhm){
  if($x.type -eq 'Temperature' -and $null -ne $x.value -and ($x.name -match 'CPU|Package|Core')){
    $cpuTemp=$x.value; $cpuTempSrc='LibreHardwareMonitor / '+$x.name; break
  }
}
if($null -eq $cpuTemp -and $zones.Count -gt 0){
  $cpuTemp=$zones[0].tempC; $cpuTempSrc='ACPI ThermalZone / '+$zones[0].name
}
$fansReal=@($fans | Where-Object { $_.rpm -gt 0 })
if($fansReal.Count -eq 0){
  foreach($x in $lhm){ if($x.type -eq 'Fan' -and $x.value -gt 0){
    $fansReal += [ordered]@{ name=$x.name; rpm=[int]$x.value } } }
}
$hasDiskTemp=$false; foreach($x in $disks){ if($null -ne $x.tempC){ $hasDiskTemp=$true } }
$supported = ($null -ne $cpuTemp) -or ($fansReal.Count -gt 0) -or ($lhm.Count -gt 0) -or ($zones.Count -gt 0)
$note = if($supported){ '传感器读数来自本机 WMI / ACPI / 硬件监控服务' }
        else { '本机未通过 WMI / ACPI 暴露温度与风扇传感器。要读取驱动级传感器，请安装 LibreHardwareMonitor 并启用其 WMI/Remote Web Server 选项。' }

$osInfo = [ordered]@{ caption=[string]$os.Caption; version=[string]$os.Version;
  build=[string]$os.BuildNumber; arch=[string]$os.OSArchitecture;
  installDate=$(if($os.InstallDate){$os.InstallDate.ToString('yyyy-MM-dd')}else{''});
  lastBoot=$(if($os.LastBootUpTime){$os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')}else{''});
  uptimeSec=[int][math]::Round(((Get-Date)-$os.LastBootUpTime).TotalSeconds,0) }

[ordered]@{
  ok=$true; ts=(Get-Date).ToString('o'); hostname=[string]$env:COMPUTERNAME;
  cpu=$cpu; memory=$memory; board=$board; bios=$biosInfo; os=$osInfo;
  disks=$disks; volumes=$vols; gpus=$gpus; nics=$nics; monitors=$mons; batteries=$bats;
  sensors=[ordered]@{ cpuTempC=$cpuTemp; cpuTempSource=$cpuTempSrc; fans=$fansReal;
    thermalZones=$zones; lhmSensors=$lhm; diskTempAvailable=[bool]$hasDiskTemp;
    supported=[bool]$supported; note=$note };
  system=[ordered]@{ maker=[string]$cs.Manufacturer; model=[string]$cs.Model;
    domain=[string]$cs.Domain; userName=[string]$cs.UserName; systemType=[string]$cs.SystemType;
    hypervisorPresent=[bool]$cs.HypervisorPresent }
} | ConvertTo-Json -Compress -Depth 8`, 35000);
  return { ok: r.ok, data: r.data || {}, error: r.err };
}, force); }

/* 供 2 秒指标循环读取真实 CPU 温度；无传感器时返回 null（不编造） */
function cpuTemp() {
  const c = cache.get('hardware');
  const d = c && c.v && c.v.data;
  const t = d && d.sensors && d.sensors.cpuTempC;
  return (t === null || t === undefined || t === '') ? null : t;
}

/* ------------------------- 写操作（真实执行） ------------------------- */
/* net.exe session 是同步阻塞调用（约 1s）。每次 /api/health 都执行会阻塞
 * Node 事件循环，让前端 probe 超时回落 demo。进程提权状态运行期不变，缓存一次即可。 */
let _adminCached = null;
function isAdmin() {
  if (!IS_WIN) return false;
  if (_adminCached !== null) return _adminCached;
  try { cp.execFileSync('net.exe', ['session'], { stdio: 'ignore', windowsHide: true, timeout: 4000 }); _adminCached = true; }
  catch (e) { _adminCached = false; }
  return _adminCached;
}
function needAdmin() { return { ok: false, error: '此操作需要管理员权限，请用「以管理员身份运行」启动 start.bat' }; }

async function run(script, timeout) {
  const r = await ps(script, timeout || 30000);
  return { ok: r.ok, out: (r.out + (r.err ? '\n' + r.err : '')).trim().slice(0, 12000), err: r.err };
}

async function serviceAction(name, act) {
  if (!safeId(name)) return { ok: false, error: '非法服务名' };
  if (!['start', 'stop', 'restart', 'pause', 'resume', 'auto', 'manual', 'disabled'].includes(act))
    return { ok: false, error: '不支持的操作' };
  if (['auto', 'manual', 'disabled'].includes(act) && !isAdmin()) return needAdmin();
  if (['start', 'stop', 'restart'].includes(act) && !isAdmin()) {
    // 普通用户可能仍有权操作部分服务，先尝试，失败再给明确提示
  }
  const verb = { start: 'Start-Service', stop: 'Stop-Service', restart: 'Restart-Service', pause: 'Suspend-Service', resume: 'Resume-Service' }[act];
  const script = verb
    ? `${verb} -Name ${q(name)} -Force -ErrorAction Stop; (Get-Service -Name ${q(name)}).Status`
    : `Set-Service -Name ${q(name)} -StartupType ${q(act)} -ErrorAction Stop; (Get-CimInstance Win32_Service -Filter "Name=${q(name)}").StartMode`;
  const r = await run(HEAD + script, 40000);
  if (!r.ok) return { ok: false, error: clean(r.out, 500) || '操作失败（可能需要管理员权限）' };
  drop(['services']);
  return { ok: true, out: r.out };
}

async function firewallRule(o) {
  if (!isAdmin()) return needAdmin();
  const act = String(o.act || 'add');
  const name = String(o.name || '').trim();
  if (act === 'delete') {
    if (!safeId(name)) return { ok: false, error: '非法规则名' };
    const r = await run(HEAD + `Remove-NetFirewallRule -DisplayName ${q(name)} -ErrorAction Stop; 'DELETED'`, 25000);
    drop(['firewall']);
    return { ok: r.ok, out: r.out, error: r.out.includes('DELETED') ? '' : clean(r.out, 400) };
  }
  if (!safeId(name)) return { ok: false, error: '规则名只允许字母数字、点、下划线、连字符、空格' };
  const dir = ['Inbound', 'Outbound'].includes(o.dir) ? o.dir : 'Inbound';
  const action = ['Allow', 'Block'].includes(o.action) ? o.action : 'Block';
  const proto = ['TCP', 'UDP', 'Any'].includes(o.proto) ? o.proto : 'TCP';
  const portRaw = String(o.port || '').trim();
  if (portRaw && !/^[0-9,\-]{1,40}$/.test(portRaw)) return { ok: false, error: '端口格式不合法' };
  const remote = String(o.remote || 'Any').trim();
  if (!/^[0-9a-zA-Z*.,\-\/ :]{1,120}$/.test(remote)) return { ok: false, error: '远程地址格式不合法' };
  const portClause = portRaw ? `-Protocol ${q(proto)} -LocalPort ${q(portRaw)}` : '';
  const script = `New-NetFirewallRule -DisplayName ${q(name)} -Direction ${q(dir)} -Action ${q(action)} ${portClause} -RemoteAddress ${q(remote)} -Profile Any -ErrorAction Stop | Select-Object -ExpandProperty DisplayName`;
  const r = await run(HEAD + script, 25000);
  if (!r.ok || !r.out.includes(name)) return { ok: false, error: clean(r.out, 500) || '新增规则失败' };
  drop(['firewall']);
  return { ok: true, out: r.out };
}

async function firewallProfile(name, enabled) {
  if (!isAdmin()) return needAdmin();
  if (!['Domain', 'Private', 'Public'].includes(name)) return { ok: false, error: '非法配置文件名' };
  const r = await run(HEAD + `Set-NetFirewallProfile -Profile ${q(name)} -Enabled ${q(enabled ? 'True' : 'False')} -ErrorAction Stop; (Get-NetFirewallProfile -Profile ${q(name)}).Enabled`, 20000);
  drop(['firewall']);
  return { ok: r.ok, out: r.out, error: r.ok ? '' : clean(r.out, 400) };
}

async function shareAction(o) {
  if (!isAdmin()) return needAdmin();
  const act = String(o.act || 'add'), name = String(o.name || '').trim(), p = String(o.path || '').trim();
  if (!safeId(name)) return { ok: false, error: '非法共享名' };
  if (act === 'delete') {
    const r = await run(HEAD + `Remove-SmbShare -Name ${q(name)} -Force -ErrorAction Stop; 'DELETED'`, 25000);
    drop(['shares']);
    return { ok: r.ok && r.out.includes('DELETED'), out: r.out, error: clean(r.out, 400) };
  }
  if (!/^[A-Za-z]:[\\\/][^\r\n]{0,240}$/.test(p)) return { ok: false, error: '需要本机绝对路径，例如 C:\\Share' };
  const r = await run(HEAD + `New-SmbShare -Name ${q(name)} -Path ${q(p)} -FullAccess ${q(os.userInfo().username || 'Everyone')} -ErrorAction Stop | Select-Object -ExpandProperty Name`, 30000);
  drop(['shares']);
  return { ok: r.ok && r.out.includes(name), out: r.out, error: clean(r.out, 500) };
}

async function vssCreate(volume) {
  if (!isAdmin()) return needAdmin();
  const v = String(volume || 'C:');
  if (!/^[A-Za-z]:\\?$/.test(v)) return { ok: false, error: '非法卷标' };
  const vol = v.endsWith('\\') ? v : v + '\\';
  const r = await run(HEAD + `(Get-CimInstance Win32_ShadowCopy -ErrorAction SilentlyContinue | Measure-Object).Count; vssadmin create shadow /For=${vol.replace(/\\$/, '')} /AutoRetry=1`, 90000);
  drop(['vss']);
  return { ok: r.ok && !/access is denied|拒绝访问|error/i.test(r.out), out: r.out, error: r.ok ? '' : clean(r.out, 600) };
}

async function taskAction(name, act) {
  if (!safeId(name)) return { ok: false, error: '非法任务名' };
  const verb = { start: 'Start-ScheduledTask', stop: 'Stop-ScheduledTask', enable: 'Enable-ScheduledTask', disable: 'Disable-ScheduledTask' }[act];
  if (!verb) return { ok: false, error: '不支持的操作' };
  const r = await run(HEAD + `${verb} -TaskName ${q(name)} -ErrorAction Stop; (Get-ScheduledTask -TaskName ${q(name)}).State`, 30000);
  drop(['tasks']);
  return { ok: r.ok && !/error|denied|拒绝/i.test(r.out), out: r.out, error: r.ok ? '' : clean(r.out, 400) };
}

async function processKill(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: '非法 PID' };
  const r = await run(HEAD + `Stop-Process -Id ${n} -Force -ErrorAction Stop; 'KILLED'`, 15000);
  drop(['processes']);
  return { ok: r.out.includes('KILLED'), out: r.out, error: clean(r.out, 400) };
}

/* winget：真实安装/卸载（长耗时，异步返回） */
async function winget(action, id) {
  if (!/^[A-Za-z0-9.\-_+]{1,120}$/.test(String(id || ''))) return { ok: false, error: '非法包名' };
  if (!['install', 'uninstall', 'upgrade'].includes(action)) return { ok: false, error: '不支持的操作' };
  const args = action === 'uninstall'
    ? `winget uninstall --id ${q(id)} --silent --accept-source-agreements --disable-interactivity`
    : `winget ${action} --id ${q(id)} -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`;
  const r = await run(HEAD + args, 180000);
  drop(['apps']);
  return { ok: r.ok, out: r.out.slice(0, 6000), error: r.ok ? '' : clean(r.out, 600) };
}

async function defenderScan() {
  const r = await run(HEAD + `Start-MpScan -ScanType QuickScan -ErrorAction Stop; 'SCAN_STARTED'`, 60000);
  return { ok: r.out.includes('SCAN_STARTED'), out: r.out, error: clean(r.out, 400) };
}

/* 电源：60 秒延时、可取消，避免误触直接关机 */
let powerTimer = null;
async function power(act, cancel) {
  if (cancel) {
    if (powerTimer) { clearTimeout(powerTimer); powerTimer = null; }
    try { cp.execFileSync('shutdown.exe', ['/a'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch (e) {}
    return { ok: true, executed: false, message: '已取消关机/重启计划' };
  }
  if (act === 'reboot') act = 'restart';
  if (!['shutdown', 'restart', 'sleep', 'lock', 'logoff'].includes(act)) return { ok: false, error: '不支持的电源操作' };
  if (act === 'lock') {
    cp.exec('rundll32.exe user32.dll,LockWorkStation', { windowsHide: true });
    return { ok: true, executed: true, message: '已锁定工作站' };
  }
  if (act === 'sleep') {
    cp.exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true });
    return { ok: true, executed: true, message: '已进入睡眠' };
  }
  const flag = act === 'restart' ? '/r' : act === 'logoff' ? '/l' : '/s';
  const delay = act === 'logoff' ? 0 : 60;
  const args = act === 'logoff' ? ['/l'] : [flag, '/t', String(delay), '/c', 'NasDeck Web 发起的系统电源操作（60 秒后执行，可在 NasDeck 内取消）', '/f'];
  // 先只做「计划」，60 秒后由本进程执行真正命令；期间可随时取消
  return { ok: true, executed: false, scheduled: true, delay,
    message: act === 'restart' ? '重启已排程，60 秒后执行' : '关机已排程，60 秒后执行',
    run: () => {
      try { cp.execFileSync('shutdown.exe', args, { windowsHide: true, stdio: 'ignore', timeout: 8000 }); return true; }
      catch (e) { return false; }
    }
  };
}

/* 网络诊断 */
async function netDiag(act) {
  const map = {
    ipconfig: 'ipconfig /all',
    ping: 'ping -n 4 223.5.5.5',
    dns: 'ipconfig /flushdns; Get-DnsClientCache | Select-Object -First 12 Name,Type,Data | Format-Table -AutoSize | Out-String -Width 200',
    route: 'route print',
    netstat: 'netstat -ano | Select-Object -First 60',
    wifi: 'netsh wlan show profiles'
  };
  if (!map[act]) return { ok: false, error: '不支持的诊断命令' };
  const r = await run(map[act], 40000);
  return { ok: true, out: r.out || r.err || '(无输出)' };
}

/* ---------------- 后台预热 + 快照 ----------------
 * WMI/CIM 采集较慢（防火墙规则约 20s），不能阻塞登录。
 * 服务启动时后台分批预热，登录接口只返回「当前已缓存」的数据，
 * 每批完成后通过 SSE 推 winready，前端再来拉 /api/win/snapshot。
 */
const COLLECTORS = { system, services, firewall, shares, adapters, events, tasks,
  apps, processes, connections, storage, defender, users, vss, hardware };
const ALL_KEYS = Object.keys(COLLECTORS);
const WARM_GROUPS = [
  ['system', 'storage', 'defender', 'users'],
  ['hardware'],
  ['services', 'tasks', 'apps', 'processes', 'events'],
  ['shares', 'adapters', 'connections', 'vss'],
  ['firewall']
];
function peek(key) { const c = cache.get(key); return c ? c.v : null; }
function progress() {
  return { ready: ALL_KEYS.filter(k => peek(k)), pending: ALL_KEYS.filter(k => !peek(k)) };
}
let warming = false;
function broken(k) {
  const v = peek(k);
  return !v || !!v.error;   // 采集函数把 PowerShell 失败塞进 error 字段，而不是 reject
}
async function warmup(emit) {
  if (warming || !IS_WIN) return progress();
  warming = true;
  /* 第一遍：分组并行，尽快把大部分数据推给前端 */
  for (const group of WARM_GROUPS) {
    await Promise.all(group.map(k => COLLECTORS[k](true).catch(() => null)));
    try { if (emit) emit('winready', progress()); } catch (e) {}
  }
  /* 第二遍：并发 CIM/PowerShell 竞争会造成 45s 超时，
     对失败项串行重试一次（此时无并发，单跑 10~15s 即可成功） */
  for (const k of ALL_KEYS) {
    if (!broken(k)) continue;
    try { drop([k]); await COLLECTORS[k](true); } catch (e) {}
    try { if (emit) emit('winready', progress()); } catch (e) {}
  }
  warming = false;
  return progress();
}

function snapshotAll() {
  if (!IS_WIN) return { ok: false, platform: process.platform, error: '仅支持 Windows 原生模式', ...progress() };
  const sys = peek('system') || {}, svc = peek('services') || {}, fw = peek('firewall') || {},
    sh = peek('shares') || {}, ad = peek('adapters') || {}, ev = peek('events') || {},
    tk = peek('tasks') || {}, ap = peek('apps') || {}, pr = peek('processes') || {},
    cn = peek('connections') || {}, st = peek('storage') || {}, df = peek('defender') || {},
    us = peek('users') || {}, vs = peek('vss') || {}, hw = peek('hardware') || {};
  return {
    ok: true, platform: 'win32', ...progress(),
    admin: isAdmin(),
    system: sys.data || sys, services: svc.services || [],
    firewall: { profiles: fw.profiles || [], rules: fw.rules || [], total: fw.total || 0, error: fw.error },
    shares: sh.shares || [], adapters: ad.adapters || [], events: ev.events || [],
    tasks: tk.tasks || [], apps: ap.apps || [], processes: pr.processes || [],
    connections: { listen: cn.listen || [], established: cn.established || [], counts: cn.counts || {} },
    storage: st.data || {}, defender: df.data || {}, users: us.data || {}, vss: vs,
    hardware: hw.data || {},
    errors: { system: sys.error, services: svc.error, firewall: fw.error, shares: sh.error,
      adapters: ad.error, events: ev.error, tasks: tk.error, apps: ap.error, processes: pr.error,
      hardware: hw.error }
  };
}

module.exports = {
  IS_WIN, isAdmin, needAdmin, ps, psJson,
  system, services, firewall, shares, adapters, vss, events, tasks, apps,
  processes, connections, storage, defender, users, perf, hardware, cpuTemp,
  snapshotAll, warmup, progress,
  serviceAction, firewallRule, firewallProfile, shareAction, vssCreate,
  taskAction, processKill, winget, defenderScan, power, netDiag, drop
};
