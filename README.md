# Scrcpy over WebRTC (CloudPhone)

中文 | [English](README.en.md)

基于 WebRTC 和 Scrcpy 的高性能、低延迟云手机解决方案，无需客户端，可以通过网页直接连接。
采用 **Fat Agent (直连模式)** 架构，结合 **硬件级 PTS 透传** 技术，实现媲美原生 Scrcpy 的丝滑体验。

<p align="center">
  <img src="screenshot/screenshot-pc.png" width="70%" />
  <img src="screenshot/screenshot-phone.jpg" width="20%" />
</p>

## 核心特性

- **极致流畅**: 采用零扫描流解析 (Zero-Search Parsing)，不引入新的内存拷贝，性能和原生scrcpy基本一致。
- ~~**公网增强**: ≈原生支持 IPv6 直连，彻底绕过运营商 CGNAT 封锁，显著提升移动网络下的打洞成功率。~~ (功能不稳定，已移除)
- **全能交互**: 支持多指触控、物理按键模拟、自定义映射（键盘按键映射到屏幕）、WebADB 终端、实时快照。
- **动态控制**: 支持在连接前或连接后通过 UI 面板动态修改设备分辨率、码率、帧率以及开启/关闭 BWE 动态码率。
- **一键部署**: 支持 WebUSB/WebADB 浏览器直连物理设备部署，无需本地安装 ADB 环境。
- **网页直连**: 支持所有终端（IOS/Android/Win/Mac/Linux）通过浏览器连接。
- **摆脱ADB**: 部署后无需通过有线或无线的形式连接adb，并支持将adb转发到网页中直接使用。

## 目录结构

```
ScrcpyOverWebRTC/
├── web-app/              # 前端源代码
├── bin/                  # 信令服务器
│   ├── linux_amd64/
│   ├── linux_arm64/
│   ├── darwin_amd64/
│   ├── darwin_arm64/
│   ├── windows_amd64/
│   └── windows_arm64/
├── agentd/               # Android Agent
│   ├── cloudphone-agent-arm64
│   ├── cloudphone-agent-amd64
│   ├── scrcpy-server.jar
│   └── run.sh
├── android/             # Android 端独立包 (可在Android系统内完整运行)
│   ├── webrtc-signaling
│   ├── cloudphone-agent
│   ├── scrcpy-server.jar
│   └── setup.sh
├── start_server.sh      # 启动脚本
├── build.sh             # 编译打包脚本
└── README.md
```

## 快速开始

### 1. 启动服务器

```bash
# 默认启动
./start_server.sh
```
*Windows 用户请进入 `bin/` 目录运行 `run.bat`*

启动后在浏览器访问：`http://localhost:8443`

### 2. 部署 Agent 到 Android

```bash
cd agentd
./run.sh -id my-phone -signaling ws://<服务器IP>:8443
```

#### 3. Android 本地全环境运行 (脱离电脑)
你可以将包含信令服务器在内的全套环境推送到手机内执行，让手机自身成为服务器：
1. 推送安卓独立包与静态资源：
   ```bash
   adb push android /data/local/tmp/
   adb push assets /data/local/tmp/android/
   ```
2. 在手机中启动：
   ```bash
   adb shell sh /data/local/tmp/android/setup.sh
   ```

#### 4. Docker / Redroid 容器
Agent 运行在隔离容器内时，需指定宿主机ip, 并在Docker启动参数中增加 `-p 50000:50000/udp`
```bash
./run.sh -id redroid-01 \
  -signaling ws://<服务器IP>:8443 \
  -external-addr "<宿主机-IP>" \
  -webrtc-port 50000
```

## 前端开发 (web-app)

前端代码全部开源，您可以自由修改 UI、调整交互或进行二次开发。

### 快速构建
```bash
./build.sh
```

### 技术栈
- Vue 3 + Composition API
- Vite 构建工具
- Pinia 状态管理
- WebRTC 数据流与视频流通信

### 本地开发调试
```bash
cd web-app
npm install
npm run dev
```

### 功能特性
- **纯网页端设备矩阵**: 实时显示在线设备与画面快照。
- **低延迟控制**: WebRTC 视频流 + 自定义协议的触摸/按键映射。
- **自定义改键引擎**: 支持点击、滑动、虚拟摇杆及命令等多种自定义映射。
- **WebADB 控制台**: 内嵌基于 `xterm.js` 的终端与原生 ADB 隧道，实现云端免驱调试。
- **参数动态设置**: 支持在连接前通过 UI 界面动态配置码率、最大分辨率、帧率、BWE 动态带宽以及日志级别。

## Agent 部署参数

```bash
./run.sh -id <设备ID> -signaling ws://<服务器IP>:8443 [其他参数]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-id` | 设备唯一标识 | 必填 |
| `-signaling` | 信令服务器地址 | 必填 |
| `-external-addr` | 手动指定宿主机或公网 IP | 自动检测 |
| `-webrtc-port` | WebRTC 绑定的固定通信端口 | 50000 |
| `-bitrate` | 视频码率 (bps) | 4000000 |
| `-max-fps` | 最高帧率 | 不限制 |
| `-max-size` | 视频最长边 | 不限制 |
| `-bwe` | 启用 WebRTC 带宽评估 (TWCC) 及动态码率调节 | true |
| `-snapshot-interval`| 仪表盘快照更新频率 (秒) | 10 |
| `-root` | 强制以 Root 权限启动服务 | false |

## 协议说明 (面向第三方对接)

前端暴露的底层协议信息，方便您接入自己的客户端系统：

### 信令协议 (WebSocket)
- 接口路径: `/connect_client`
- 支持的消息指令: `offer`, `answer`, `ice_candidate`, `device_list`, `device_quit`

### WebRTC DataChannel
建立 WebRTC 连接后，Agent 会开放两个关键的离带数据通道（DataChannel）：
- `input-channel`: 用于下发触摸与按键指令
- `adb-channel`: ADB 裸流传输隧道

#### Touch 控制协议示例
前端通过 `input-channel` 发送 JSON 字符串：
```json
{"type":"touch", "id":0, "action":0, "x":100, "y":200, "w":1080, "h":1920}
```
- `action`: `0`=DOWN, `1`=UP, `2`=MOVE
- `id`: 手指追踪 ID（0-9 代表触控，-1 代表鼠标）
- `x`/`y`: 坐标
- `w`/`h`: 参考屏幕宽高（Agent 内部会自动根据设备实际分辨率重新计算映射比例）

## License

**MIT License** - 前端 `web-app` 目录源代码开源。

*注意：`agentd` 与 `bin` 目录下的代理和信令服务器二进制文件仅供学习和个人测试使用。*