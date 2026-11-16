# FindMy Web 与 Windows 本地打印助手

从2026-11-13阿里云正在运行的网页和本机打印服务整理。配套服务端：[google_apple_findmy_sever](https://github.com/wenhaoran-seven/google_apple_findmy_sever)。本仓库包含静态网页、Web Serial烧录/监听、地图轨迹、公开只读页和USB打印助手，不包含账号、设备密钥或位置数据。

## 目录

|路径|用途|
|---|---|
|assets/findmy-console|当前统一管理与公开只读网页，主要开发入口|
|assets/findmy|Apple兼容网页与baidu_map.html地图iframe|
|assets/google-findmy、-2、-3|旧账号独立网页资源；保留兼容，不是当前主入口|
|local-printer|Windows PC43t打印服务、桌面启动器、PyInstaller配置|
|scripts/install_assets.py|把资源安装到后端checkout或部署目录|
|tests|jsdom前端回归测试|

无需React/Vue构建，主要是原生JavaScript/CSS/HTML。HTML由FastAPI返回时替换 `__TOKEN__` 和 `__MAP__`；直接双击HTML或只用静态服务器不能完整运行。不要将替换后的Token写进Git。

## 快速开发

建议Node.js20+、Python3.12+，Windows打印要求Windows64位。

```bash
git clone https://github.com/wenhaoran-seven/findmy_web.git
git clone https://github.com/wenhaoran-seven/google_apple_findmy_sever.git
cd findmy_web
npm ci
npm test
python scripts/install_assets.py --target ../google_apple_findmy_sever/services
```

随后按照后端README启动控制台和采集器，访问 `http://127.0.0.1:8870/`。公开只读页为 `/view`。本地开发必须指向测试数据目录，复制前端不会复制任何账号授权。

每次修改静态文件后再次执行install_assets.py，或在开发环境自行建立目录映射；当前脚本是复制，不是监听。生产在服务器上执行 `python scripts/install_assets.py --target /opt`，先确认目标源码目录存在。它只写对应服务的static目录，不重启服务、不修改账户。

## 主要模块

- `console.js`：设备表格、账号管理、设备信息、任务操作。SN相同的双平台设备合并。
- `paired-add.js`：批量SN/public key导入与双平台添加。
- `time.js`：统一时间选择器，必须独立于管理页面的全局函数。
- `unified-track.js/.css`：地图弹窗、时间和平台筛选、选中点、回放、CSV/JSON导出。默认最近7天，回放15秒。
- `viewer.html/viewer.js`：免登录只读设备页，布局沿用控制台，不包含账号管理、编辑、烧录、打印或管理员Token。
- `serial.js/serial-transport.js`：串口烧录队列。识别A-01/T-08待分配提示，允许TAG前有杂字符；成功回复后才换下一台。
- `label-print.js`：串口扫描全F6广播、显示名称/SN/MAC/RSSI/电池电压、调用本机打印接口。
- `assets/findmy/baidu_map.html`：地图iframe，输入WGS84坐标，处理显示转换与轨迹消息。

## 轨迹与只读权限

浏览器只读页调用 `/view/devices` 和 `/view/track`，管理页调用带X-Local-Token的 `/api/*`。真正的修改隔离在服务端和网关，不是禁用按钮。公开轨迹API也只返回白名单位置字段。

轨迹先拉取当前筛选范围最新10点，然后每批200点；加载期间可查看、选中已加载点。切换时间/设备取消旧请求，完整加载后才能导出，避免把部分数据误当全部。列表先展示20项，滚动加载更多DOM行；这与网络分页是两层机制。地图预加载只是浏览器预热，不是离线下载地图。

`/view` 公开展示位置；默认没有登录。不要在其中加入私钥、账号邮箱或编辑接口。公开访问策略由后端仓库Caddy配置控制。

## 浏览器串口

使用Chrome/Edge，部署页面必须HTTPS（localhost可用于开发），用户选择串口并授权。首次连接、刷新页面、拔插设备时浏览器可能要求重新选择；无法绕过浏览器授权。

- 烧录与扫描不是同一功能，避免两个页面同时占用同一COM。
- 扫描器打开后发送 `AT+SCAN1\r\n`，结束发送 `AT+SCAN0\r\n`。
- 识别广播MAC为全F6，按固件约定解码SN、真实MAC和电压；队列以收到成功回执为准。
- 断电/更换设备引发 `The device has been lost` 属于USB设备移除，页面应暂停并重连，不把断线当烧录成功。

## Windows本地打印助手

云端不能直接访问另一台电脑的USB打印机。每台打印电脑需要安装打印机/串口驱动，启动本机助手，并允许浏览器访问本地网络。

```powershell
cd local-printer
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe launcher.py
```

桌面启动器选择Windows打印队列、保存并启动后台服务。默认接口 `http://127.0.0.1:18765`，只监听本机；`GET /health`检查状态。PC43t203dpi USB为当前验证机型，打印经Windows驱动/GDI完成，不弹系统打印窗口。

配置和状态通常位于 `%LOCALAPPDATA%/FindMyPrint`；源码直接启动service.py的默认目录可能是local-printer/data，可用FINDMY_PRINTER_DATA统一指定。不要把打印任务状态和本机配置提交Git。

新域名/测试端口需检查 `service.py` 的ORIGINS及 `launcher.py` 的URL；不能放开任意Origin。缺字体时安装黑体SimHei、微软雅黑或宋体；字体不随包发布。二维码与字体按203dpi栅格渲染，不是矢量打印。

### 打包独立EXE

在Windows上，在仓库根目录执行（可复用你的虚拟环境）：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r local-printer/requirements.txt pyinstaller
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm local-printer/FindMyPrint.spec
```

复制完整 `dist/FindMyPrint/` 文件夹，不能只复制exe。运行 `FindMyPrint.exe --self-test` 仅生成测试结果，不实际打印。新电脑仍需要驱动和字体。仅修改网页打印参数不需要重启服务；修改服务代码或协议才需要升级/重启助手。

### 标签规则

默认一行5张：SN二维码、SN字符、MAC二维码、MAC字符、设备名称。张数少于5时忽略后面的内容，不换行；超过5的额外标签留空。二维码纠错、尺寸、纸张/间距/留白/偏移/字体由网页每次新任务传入。名称汉字按2个英文/数字计，超限分成长度接近的两行。

任务UUID用于防重发；驱动报告完成在页面标为打印完成，但它不能证明实际出纸和二维码可读。重新打印创建新任务。未确认结果时不要盲目循环提交，先核对队列与实物。

## 测试、发布与排查

`npm test` 包括真实只读页面组合脚本点击轨迹测试，专门防止“单个接口正常但页面无法打开”的问题；jsdom不能证明真实地图渲染、Web Serial权限和物理打印正常，需要另做浏览器/实机验收。

发布步骤：前后端测试 → 备份目标文件 → 安装静态资源 → 更新HTML资源版本号 → 浏览器刷新 → 验证管理入口认证、公开页只读、轨迹加载与导出。纯静态改动一般无需重启Python服务；改API则需要按后端流程重启。

常见故障：

|现象|排查|
|---|---|
|轨迹点击没反应|浏览器控制台、time.js是否依赖管理页全局变量、是否加载最新脚本|
|地图空白|MAP_ORIGIN、iframe父页面允许列表、百度AK类型/域名白名单|
|Failed to fetch打印|本机18765服务、Origin白名单、浏览器本地网络权限、HTTPS到loopback策略|
|有出纸但二维码难扫|标签尺寸、203dpi模块像素、静区、打印浓度和碳带|
|页面旧布局|HTML版本号、浏览器缓存、资源是否复制到当前服务目录|

## 第三方与数据边界

内置qrcode.js保留文件中的第三方版权/许可证信息；其它组件遵循各自许可证。本仓库不包含用户数据、秘密、exe、node_modules和虚拟环境。生产公网地址作为兼容默认值仍可能出现在代码中，迁移域名时需统一调整，它不代表新环境已部署。

### 百度浏览器 AK

地图模板保留 `__BAIDU_BROWSER_AK__`。安装前设置环境变量 `BAIDU_BROWSER_AK`，脚本只在部署副本填入，不改仓库。未配置时百度地图不可用。浏览器 AK 与服务端逆地理编码 AK 不同，浏览器 AK 应设置域名限制。

### 独立后台控制任务

console.js 的 `api()` 使用 `X-Control-Async: 1`。账号代理接口返回 HTTP 202 + `control_task`，前端每秒查询任务状态；成功后才把结果交回原有登录/注册/串口配置流程。修改名称立即保存到统一控制数据库，页面提示后台同步，不再宣称已核对所有采集器。请同时部署后端的 `findmy-control-worker`；普通设备列表与轨迹请求只读数据库。无需修改本机串口或打印助手。

### 手动标签打印

标签打印页可输入 12 位 SN 和名称，使用现有纸张/字号/二维码参数直接提交本机打印服务，不需要串口连接。MAC 按 SN 从平台设备列表匹配；无法取得 MAC 时保留第 3、4 张空白，SN 和名称保持原位置。手动名称仅用于标签，不修改平台名称，不被后台名称刷新覆盖。成功记录与串口记录共用已打印标识，重新提交已有记录需确认。

本机 `local-printer/service.py` 的 `/health` 返回 `optional_mac: true` 才支持无 MAC 打印。旧服务仍可打印带 MAC 的手动任务；更新代码后需重启本机打印服务一次（无需重启电脑）。验证：`node tests/test_manual_print.cjs` 使用模拟打印接口，不会实际出纸。
