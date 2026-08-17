# MaaAssistantBD2

面向 Windows 桌面版《棕色尘埃2》的自动化助手框架。目前已完成 UI、Win32 窗口绑定与截图诊断、坐标映射、任务注册、队列持久化和模拟调度流程。具体游戏识别、资源和输入逻辑均使用 TODO 占位，尚不会执行真实游戏操作。

## 运行

需要 Node.js 24 或兼容版本：

```text
npm start
```

默认地址：`http://127.0.0.1:4173`

## 测试

```text
npm run test:backend
```

测试使用 Node 后台测试程序，覆盖 Win32 接口错误处理、坐标映射、fake Controller、任务定义、计划存储、调度生命周期、重试和取消。

## 结构

```text
data/                 本地任务计划
resources/tasks/      游戏任务资源占位
src/core/             坐标映射、Controller、Vision 和 Pipeline 抽象
src/tasks/            任务定义、资源加载、计划存储和调度器
test/                 后台自动化测试
web/                  UI 原型
server.js             本地服务及 Win32 诊断 API
```

整体规划见 `TASK_PLAN.MD`，参考项目研究见 `findings.md`。
