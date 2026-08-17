<!-- markdownlint-disable MD013 -->

# MaaAssistantArknights 架构、功能与界面研究

> 研究对象：<https://github.com/MaaAssistantArknights/MaaAssistantArknights>
>
> 分析分支：`dev-v2`（仓库默认分支）
>
> 分析提交：`77247c353dc5247682f277bfac0d4e43ef2d504b`，提交时间 2026-08-16 21:05:01 UTC
>
> 分析日期：2026-08-17

## 1. 结论摘要

MAA 不是一个将所有自动化逻辑写在 GUI 事件中的单体应用。它的核心设计是一个与界面解耦的 C++ 自动化引擎，外部宿主通过稳定 C ABI、JSON 参数和异步回调调用它；引擎内部再以“数据驱动视觉状态图 + C++ 业务插件”实现游戏流程。

最值得本项目借鉴的原则：

1. Core 与 GUI 严格单向依赖，GUI 只负责任务配置、编排和反馈。
2. 设备操作统一经过 Controller，业务任务只面对标准坐标和通用操作。
3. 普通 UI 流程写成可更新的 JSON 状态图，复杂策略才进入代码。
4. 基础资源与地区/版本差异采用 overlay，避免复制完整资源树。
5. 主界面把任务队列、当前参数和实时输出放在同一工作台中。
6. 运行状态贯穿任务行、日志、任务栏、悬浮窗、托盘和系统通知。

不应直接照搬的部分：GUI 中混用 DI、Service Locator 和静态单例；固定尺寸三列布局；依赖 hover、右键和颜色表达关键功能；核心状态机、线程生命周期和 ABI 的自动化测试不足。

## 2. 仓库结构与技术栈

```text
MaaAssistantArknights/
├─ include/                 MaaCore 公开 C ABI
├─ src/
│  ├─ MaaCore/             C++20 自动化引擎
│  ├─ MaaWpfGui/           Windows 默认 GUI
│  ├─ MaaUpdater/          更新器
│  ├─ Cpp/                 C API 示例及 smoke test 宿主
│  ├─ Python|Java|Rust.../ 多语言绑定与示例
│  └─ MaaMacGui|maa-cli.../独立 submodule 宿主
├─ resource/               任务图、模板、OCR/ONNX 模型和业务数据
├─ tools/                  资源生成、优化、OTA、发布和测试工具
├─ unit_test/              Catch2 单元测试
├─ docs/                   VuePress 文档及协议
└─ .github/workflows/      多平台构建、发布和资源校验
```

- Core：C++20、CMake 3.28+、OpenCV、PaddleOCR/FastDeploy、ONNX Runtime、Zlib、Boost.System。
- Windows GUI：.NET 10、C# 14、WPF、Stylet/StyletIoC、HandyControls、Serilog、Newtonsoft.Json。
- 平台：Windows、Linux、macOS、Android，多架构 preset；Windows 默认构建 WPF GUI。
- 测试：Catch2 单测加完整资源 smoke test，但单测主要覆盖算法，核心任务框架覆盖不足。
- 许可证：主体为 `AGPL-3.0-only`，Logo 另有权利保留。后续只能借鉴思路；若复制或改编源码、XAML、资源或素材，必须先评估 AGPL 和素材授权义务。

关键入口：

- `CMakeLists.txt`：顶层构建选项和模块装配。
- `src/MaaCore/CMakeLists.txt`：Core 依赖与共享库定义。
- `src/MaaWpfGui/MaaWpfGui.csproj`：Windows GUI 技术栈。
- `.gitmodules`：CLI、macOS GUI、跨平台 GUI、工具库和测试集拆仓关系。

## 3. 整体架构

```text
WPF / CLI / Python / Java / Rust 等宿主
                 │
                 │ C ABI + UTF-8 JSON + callback
                 ▼
              Assistant
      实例、任务队列、线程和生命周期
                 │
                 ▼
       InterfaceTask / PackageTask
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
 ProcessTask             TaskPlugin
 JSON 状态图解释器       复杂业务策略
       │                    │
       └─────────┬──────────┘
                 ▼
 PipelineAnalyzer / 专用 Vision Analyzer
 模板匹配、OCR、特征匹配、业务识别
                 │
                 ▼
 Controller / ControlScaleProxy
 ADB、Minitouch、MaaTouch、Win32、MuMu 等
                 │
                 ▼
             游戏客户端

 resource/tasks + template + OCR/ONNX + 业务 JSON
                 └──────────────► MaaCore 运行时加载
```

### 3.1 对外边界

`include/AsstCaller.h` 暴露纯 C API：

```text
AsstLoadResource
→ AsstCreateEx(callback)
→ AsstAsyncConnect / AsstAsyncAttachWindow
→ AsstAppendTask(type, params_json)
→ AsstStart
→ callback(msg, details_json)
→ AsstStop / AsstDestroy
```

设计优点：

- `AsstHandle` 是 opaque pointer，不暴露 C++ 类布局。
- 使用固定宽度整数、UTF-8 JSON 和调用方提供的 buffer，避免跨 DLL 内存所有权问题。
- ABI 与任务协议分开：函数签名稳定，任务参数和回调 JSON 可以独立演进。
- 多语言绑定都复用同一能力，不需要让 Core 依赖某个 GUI 框架。

注意：callback JSON 在官方文档中被视为快速演进协议。后续项目若采用同类方案，应增加 schema version、能力协商和废弃周期，不能只依赖字符串约定。

### 3.2 Assistant 与并发模型

`src/MaaCore/Assistant.cpp` 是实例级编排中心：

- `append_task` 将公开任务字符串映射为 `FightTask`、`InfrastTask`、`RecruitTask`、`RoguelikeTask` 等编译期类型。
- `working_proc` 串行执行外部任务队列，并发出开始、完成、错误、停止和全部完成消息。
- `call_proc` 处理连接、截图、点击等异步控制调用。
- `msg_proc` 在独立线程按序调用外部 callback，避免 Core 工作线程直接进入 GUI 代码。
- 运行中允许 `set_task_params` 更新队列任务参数。

这是一种清晰的并发边界：业务任务保持串行确定性，设备控制和消息派发各自隔离。后续需要重点测试 Stop/Destroy、回调重入、连接中断和队列清理。

### 3.3 任务模型

任务分三层：

- `InterfaceTask`：外部可追加的业务入口，如战斗、公招、基建和肉鸽。
- `PackageTask`：按顺序组合子任务，可决定局部失败是否中断整个任务链。
- `ProcessTask`：解释资源中的视觉状态图。

`ProcessTask` 每轮执行以下流程：

1. 从候选节点列表开始。
2. 截取当前画面。
3. `PipelineAnalyzer` 按顺序尝试 `JustReturn`、模板匹配、OCR 或特征匹配。
4. 对第一个命中节点执行点击、滑动、输入、等待或停止动作。
5. 成功走 `next`，超过执行次数走 `exceededNext`，重试失败走上一节点的 `onErrorNext`。
6. 候选列表为空即任务完成。

节点执行前后发出 SubTask callback。`AbstractTaskPlugin` 可监听这些消息，在关键节点插入复杂逻辑，例如统计战斗次数、识别掉落或执行肉鸽策略。

核心经验是职责分配：页面导航、弹窗关闭、按钮定位等稳定重复流程放 JSON；需要业务状态、算法和多轮视觉推理的行为放 C++ 插件。

### 3.4 Controller 与设备抽象

`ControllerAPI` 将设备能力统一为：截图、点击、滑动、文本输入、应用启停、按键以及 capability bitmask。`Controller::create_controller` 根据运行环境选择：

- ADB 原生输入
- Minitouch / MaaTouch
- MaaFramework ADB ControlUnit
- MuMu/LD 模拟器增强通道
- macOS PlayTools
- Windows 窗口截图与输入
- Android Native

`ControlScaleProxy` 负责画面和输入坐标归一化，业务 Task 只使用标准逻辑分辨率。ADB 命令模板、包名和模拟器差异主要位于 `resource/config.json`，减少平台判断散落在业务代码中。

连接和截图具有多层恢复：自动探测 ADB/地址/备选端口，命令失败重连，首次截图实测多个方案并选择最快实现，连续截图失败才升级为连接错误。

### 3.5 视觉识别

`PipelineAnalyzer` 是通用识别入口：

- `MatchTemplate`：OpenCV 模板匹配，支持 mask、颜色空间和阈值。
- `OcrDetect`：PaddleOCR/字符模型，支持 trim、正则替换和文本过滤。
- `FeatureMatch`：特征匹配，用于模板尺度或局部变化更大的场景。
- `JustReturn`：无需截图的流程节点。

复杂业务另有专用 Analyzer，如公招标签、战斗掉落、基建设施、肉鸽地图和干员列表。通用识别能力与业务解释分离，因此相同视觉基础设施可以服务不同任务。

## 4. 资源与配置架构

`ResourceLoader` 加载以下内容：

- `resource/tasks/**/*.json`：自动化状态图 DSL。
- `resource/template/`：按钮、页面、物品、角色等模板。
- OCR 与 ONNX 模型。
- `recruitment.json`、`infrast.json`、关卡、物品和掉落数据。
- `resource/roguelike/<Theme>/`：主题级肉鸽策略、地图和招募配置。

Task DSL 主要字段包括：

```json
{
  "algorithm": "MatchTemplate | OcrDetect | FeatureMatch | JustReturn",
  "action": "ClickSelf | ClickRect | Swipe | Input | DoNothing | Stop",
  "roi": [0, 0, 1280, 720],
  "template": "...png",
  "text": ["..."],
  "next": ["NextNode"],
  "onErrorNext": ["RecoveryNode"],
  "exceededNext": ["FallbackNode"],
  "maxTimes": 3,
  "baseTask": "SharedNode"
}
```

`TaskData` 支持递归加载、`baseTask` 继承、模板任务、虚拟节点和增量覆盖，并在 Debug/校验流程中发现悬空节点、非法正则及部分重复定义。

多服务器使用“基础资源 + `resource/global/<server>` 差异资源”叠加。这个结构使外服适配通常只需要截图、OCR 文本和少量 JSON 差异，而不是复制整套任务。

后续应进一步强化：对 DSL 建立正式 JSON Schema、静态图完整性检查、overlay 冲突规则、资源版本与 Core 兼容范围，以及模板质量回归测试。

## 5. 主要功能实现

### 5.1 一键日常任务链

GUI 将用户配置的任务按顺序序列化并调用 `AsstAppendTask`，常见任务包括：开始唤醒、理智作战、基建换班、公招、信用收支、奖励领取、肉鸽和关闭游戏。Core 中每个外部任务仍可组合多个内部任务，因此 UI 队列是粗粒度业务链，Core PackageTask 是细粒度执行链。

### 5.2 启动与异常页面恢复

`StartUpTask` 负责启动客户端、切换账号并执行登录状态图。`resource/tasks/tasks.json` 覆盖公告、资源检查、更新、离线提示及主题差异。失败可重启客户端重试，体现了“错误恢复是状态图的一部分”，不是只在最外层捕获异常。

### 5.3 理智作战

`FightTask` 组合关卡导航、战斗状态机和插件：

- `StageNavigationTask` 解析章节和难度，通过 OCR 或模板定位关卡。
- `FightBegin` JSON 状态图负责进入和推进战斗。
- 次数、理智药、源石、连续作战和目标掉落由插件管理。
- `StageDropsTaskPlugin` 在战斗结束节点触发掉落识别，必要时拼接横向滚动截图，并可按目标数量停止。

### 5.4 基建换班

`InfrastTask` 按设施列表组合制造站、贸易站、发电站、控制中枢、会客室、办公室、训练室和宿舍任务。单个房间可设置失败隔离，避免局部识别问题中止整条日常链。

业务数据在 `resource/infrast.json`，自定义排班文件描述房间、产品、干员、无人机和班次计划。识别失败会保留现场截图，并尝试返回基建总览恢复。

### 5.5 自动公招

`RecruitImageAnalyzer` 通过 OCR 识别五个标签，并通过模板识别时间控件、刷新和许可状态。`AutoRecruitTask` 枚举标签组合，根据最低、最高和平均星级排序，再按用户保留标签、星级和加急许可策略执行。角色、星级和标签事实数据来自 `resource/recruitment.json`。

### 5.6 肉鸽自动化

`RoguelikeTask` 是插件化最明显的功能：控制、编队、招募、战斗、商店、遭遇、投资、结算、难度和路线由不同插件负责；主题资源提供招募优先级、关卡地图和购物策略。

战斗插件识别关卡、加载 TilePack 地图、检测部署位并循环决策，还设置明确超时恢复。部分主题启用地图路由，计算节点路线并在代价过高时触发重开。这说明复杂自动化不能只靠线性点击脚本，需要持续状态、策略算法和可恢复的任务边界。

### 5.7 自动战斗与工具箱

Copilot 功能读取作业 JSON，将阵容、技能、部署、撤退和操作时序交给 Core 执行。工具箱还包括公招识别、干员/仓库识别等手动功能，复用相同截图、OCR 和业务数据能力。

### 5.8 回调、日志与错误语义

Core 消息分为 Global、TaskChain、SubTask 和 ReportRequest。GUI 将 callback 切回 UI 线程后更新：

- 外部任务状态和聚合 task ID。
- 实时日志及语义颜色。
- Toast、外部通知和任务栏进度。
- 识别截图缩略图和错误详情。

失败层级清晰：节点可走 `onErrorNext`，专用任务可回首页，PackageTask 可忽略局部错误，不可恢复问题才升级为 SubTaskError 和 TaskChainError；手动停止使用 TaskChainStopped，不与失败混淆。

## 6. Windows 界面设计

### 6.1 应用结构

默认 GUI 的启动链为：

```text
App.xaml
→ Stylet ApplicationLoader
→ Bootstrapper<RootViewModel>
→ RootViewModel / RootView
```

顶层四个页签：

1. 一键长草：日常任务工作台。
2. 自动战斗：作业导入和执行。
3. 小工具：识别与辅助功能。
4. 设置：连接、性能、主题、通知、更新等。

`RootViewModel` 使用 `Conductor<Screen>.Collection.OneActive` 管理页面。IoC 注册集中在 `Bootstrapper`，但项目又通过 `Instances` 和各模型静态 `Instance` 暴露对象，导致生命周期和依赖关系不透明。新项目应统一构造注入和明确 ownership。

### 6.2 主任务工作台

`TaskQueueView.xaml` 采用三列布局：

```text
┌──────────────┬────────────────┬────────────────────────┐
│ 任务队列     │ 当前任务设置   │ 实时日志与截图         │
│ 启用/排序    │ 常规/高级      │ 进度、错误、结果       │
│ 增删/单次运行│ 业务参数       │                        │
├──────────────┴────────────────┴────────────────────────┤
│ Link Start / Stop / Wait and Stop                     │
└────────────────────────────────────────────────────────┘
```

这个布局适合高频桌面自动化：用户无需在“配置页”和“运行页”来回切换，任务顺序、参数和结果始终在同一上下文中。任务支持启用、拖拽排序、添加、复制、重命名、删除、单次运行和全选/清空。

主要问题是宽度大量固定为 190/210/220px，主窗口最小 800×600，没有页面级断点或窄窗口重排。后续应保持工作台模型，但实现宽、中、窄至少三档布局。

### 6.3 渐进式配置

每个任务使用窄设置面板，并分为“常规设置”和“高级设置”。例如战斗面板包含关卡、次数、理智药、源石、目标掉落、多关卡和周计划；基建面板包含模式、自定义排班、无人机、宿舍阈值和房间顺序。

值得保留：默认只展示完成主流程所需参数，高风险或低频策略延后展示。任务运行时统一锁定不应修改的参数。

不应保留：右键切换三态复选框、hover 才出现复制/删除、使用 `IsHitTestVisible` 模拟禁用。这些交互难发现且不利于辅助技术，应提供持续可见且键盘可达的入口。

### 6.4 状态反馈

MAA 的反馈不是单一日志框，而是多层输出：

- 任务行：运行中蓝色、成功绿色、失败红色、跳过半透明。
- 日志区：文本或卡片日志、时间、详情、语义颜色和截图缩略图。
- Windows 任务栏：总体进度。
- 悬浮窗：可绑定模拟器窗口的实时日志。
- 托盘和系统通知：后台运行和完成提醒。
- 外部通知：ServerChan、Telegram、Discord、SMTP、Bark、Gotify、自定义 Webhook 等。

该闭环值得借鉴，但状态不应只依赖颜色和透明度。后续要增加状态图标、文本、屏幕阅读器 Live Region 和可靠焦点反馈。

### 6.5 设置与导航

设置页采用左侧 175px 分区导航和右侧长滚动内容，约 15 个 Expander 覆盖配置、定时、性能、连接、启动、远控、UI、背景、通知、热键、成就、更新和反馈。设置搜索会过滤分区并高亮命中项。

搜索与高亮非常适合复杂工具，但大量设置不宜一次性实例化到一个长页面。新实现更适合采用分区路由、按需加载、统一搜索索引并保持命中项可深链接。

### 6.6 主题、国际化与产品气质

- 主题：亮色、暗色、跟随系统、壁纸、透明度、模糊和 Monet 取色。
- 视觉：小圆角、细边框、蓝色主色、紧凑字号、半透明区域和少量短动画。
- 国际化：简中为基础字典，叠加英语和目标语言回退；运行时替换 ResourceDictionary，同时更新 `CultureInfo` 和 WPF Language。
- 产品气质：核心是实用工具，但用壁纸、成就和彩蛋增加游戏社区感。

应借鉴语义主题 token 和完整语言回退；不应把本地化文本缓存散落到大量 ViewModel，也不应让壁纸或动态主色破坏对比度。

### 6.7 桌面集成

MAA 包含单实例唤醒、最小化到托盘、窗口位置恢复、悬浮窗、系统防休眠、多后端通知和完整更新流程。Toast 会按 WinRT、Wine `libnotify`、WPF Notification、HandyControl Growl 顺序降级。

这些功能体现了成熟桌面应用应有的运行闭环。新项目可以复用“能力探测 + 降级”思想，但应把更新、通知和窗口管理拆成独立服务，避免 Bootstrapper 成为全局编排中心。

### 6.8 可访问性问题

静态分析未发现系统性 `AutomationProperties` 使用，也缺少窄屏重排、高对比度、减少动画和字体缩放策略；部分样式移除了焦点视觉。关键操作依赖 hover、右键和拖拽。

后续界面必须补齐：

- 每个图标按钮的可访问名称和 Tooltip。
- 键盘导航、访问键、焦点顺序与焦点恢复。
- 文本或图标状态，不只使用颜色。
- 高对比度和动态主题对比度校验。
- 运行日志 Live Region 和错误焦点管理。
- 拖拽操作的按钮/菜单等价入口。

## 7. 对 MaaAssistantBD2 的建议蓝图

建议保留 MAA 的边界思想，但从更小的可验证纵切开始：

```text
Desktop UI
├─ Task Queue / Task Settings / Run Console
├─ Settings / Theme / Localization
└─ Notification / Tray / Update
            │ typed commands + typed events
            ▼
Application Service
├─ Task scheduler
├─ Connection lifecycle
├─ Run state machine
└─ Event projection
            │
            ▼
Automation Core
├─ Controller interface + fake controller
├─ Pipeline engine
├─ Vision interfaces
├─ Domain task plugins
└─ Resource loader + schema validator
```

### 7.1 必须保留的结构约束

1. UI 不直接调用 ADB、OCR 或图像匹配。
2. 业务任务不直接区分模拟器品牌和实际分辨率。
3. Core 不引用 UI 框架或 UI 文本资源。
4. 任务 DSL 只描述流程，复杂算法进入可测试代码模块。
5. callback/event 必须有稳定类型、版本和关联 ID。
6. 基础资源、客户端差异和用户覆盖具有明确加载顺序。

### 7.2 优先测试

- Core API/ABI 或 IPC contract test。
- Task DSL schema、继承、overlay 和图完整性测试。
- ProcessTask 成功、重试、`onErrorNext`、`exceededNext` 和 Stop 测试。
- fake Controller 驱动的端到端任务测试。
- callback 顺序、线程切换、停止和销毁测试。
- 多分辨率坐标归一化测试。
- OCR/模板 fixture 回归测试。
- UI ViewModel 状态投影和无障碍自动化测试。

### 7.3 UI 实现原则

- 保留三区域工作台信息架构，但不要固定像素布局。
- 宽屏三列，中屏队列 + 内容切换，窄屏使用可返回的分层导航。
- 常规/高级设置渐进展开。
- 所有后台状态都归一到一个运行状态模型。
- 日志、任务状态、系统通知和错误详情来自同一事件流。
- 主题使用语义 token；个性化背景必须可完全关闭。
- 所有鼠标快捷操作提供持续可见、键盘可达的等价入口。

## 8. 关键源码索引

| 主题 | 入口 |
| --- | --- |
| 构建总览 | `CMakeLists.txt`, `CMakePresets.json` |
| 公共 API | `include/AsstCaller.h`, `include/AsstPort.h` |
| Core 编排 | `src/MaaCore/Assistant.h`, `src/MaaCore/Assistant.cpp` |
| 任务基础类 | `src/MaaCore/Task/AbstractTask.*`, `PackageTask.*`, `ProcessTask.*` |
| 插件 | `src/MaaCore/Task/AbstractTaskPlugin.h` |
| 状态图数据 | `src/MaaCore/Config/TaskData.*`, `resource/tasks/` |
| 资源加载 | `src/MaaCore/Config/ResourceLoader.cpp` |
| 视觉管线 | `src/MaaCore/Vision/Miscellaneous/PipelineAnalyzer.cpp` |
| 设备控制 | `src/MaaCore/Controller/Controller.*`, `ControllerAPI.h`, `AdbController.*` |
| 战斗 | `src/MaaCore/Task/Interface/FightTask.cpp`, `Task/Fight/` |
| 基建 | `src/MaaCore/Task/Interface/InfrastTask.cpp`, `Task/Infrast/` |
| 公招 | `src/MaaCore/Task/Interface/RecruitTask.cpp`, `AutoRecruitTask.cpp` |
| 肉鸽 | `src/MaaCore/Task/Interface/RoguelikeTask.cpp`, `Task/Roguelike/` |
| WPF 启动 | `src/MaaWpfGui/App.xaml`, `Main/Bootstrapper.cs` |
| 主导航 | `src/MaaWpfGui/Views/UI/RootView.xaml`, `ViewModels/UI/RootViewModel.cs` |
| 任务工作台 | `src/MaaWpfGui/Views/UI/TaskQueueView.xaml`, `TaskQueueViewModel.cs` |
| Core 桥接 | `src/MaaWpfGui/Main/AsstProxy.cs`, `Services/MaaService.cs` |
| 主题与样式 | `src/MaaWpfGui/Res/Theme.xaml`, `Res/Themes/`, `Res/Styles/` |
| 国际化 | `src/MaaWpfGui/Helper/LocalizationHelper.cs`, `Res/Localizations/` |
| 托盘与通知 | `Views/UI/NotifyIcon.xaml`, `Helper/ToastNotification.cs` |
| 协议文档 | `docs/*/protocol/task-schema.md`, `callback-schema.md`, `copilot-schema.md` |

## 9. 研究限制

- 本地使用 `--depth 1` 浅克隆，只分析当前默认分支快照，没有研究历史演进和旧架构迁移过程。
- `MaaMacGui`、`MAAUnified`、`maa-cli`、`MaaUtils`、`MaaTestSet` 等 submodule 未初始化；对它们只采用 `.gitmodules`、CMake 和 CI 中可验证的信息。
- 当前模型无法直接解析仓库内 README 截图，视觉结论来自 XAML、主题资源、布局尺寸、样式和交互绑定，而非像素级截图审查。
- 未安装 CMake 和 .NET SDK，也未连接模拟器，因此没有构建或运行目标项目；功能结论来自静态源码与资源追踪。

## 10. 临时研究副本

浅克隆位于 `tmp/deps/MaaAssistantArknights/`，只用于本次研究，且已由项目 `.gitignore` 中的 `tmp/` 排除。后续若需要核对源码可暂时保留；文档中的所有结论均以顶部记录的 commit 为基线。
