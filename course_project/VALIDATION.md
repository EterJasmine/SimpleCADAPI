# 工程验证记录

## V0.2.0 本地验收（2026-11-27）

完整干净环境：sandbox-envs/course-v02-clean，最小干净环境：sandbox-envs/course-v02-mock-clean。均由 setup.ps1 新建并安装，Python 3.13.9 / Windows x64；两者 pip check 均无依赖冲突。

| 实际检查 | 结果 |
| --- | --- |
| 完整干净环境 `python -m pytest course_project/tests -q` | 39 passed，含原有 8 项 |
| 无 SDK 最小环境 `python -m pytest course_project/tests/test_readiness.py -k 'not real' -q` | 24 passed、5 deselected；确认 simplecadapi 未安装 |
| 两个干净环境实际启动 uvicorn、health、generate、STL/STEP 下载 | 通过；验收服务随后退出 |
| 安装前保护 | 不完整已有环境保留原文件；模拟版本检查失败时拒绝创建环境，2 项测试通过 |
| `npm ci`、`npm run typecheck` | 通过，Node.js 24.14.1 |
| `npm test` | 29 个测试文件，331 项通过 |
| `npm run build` | 通过；原前端存在单包超过 1600 kB 的构建提示 |
| `node course_project/verify_proxy.mjs` | 使用真实 Vite 配置及服务验证 /api/workspace、generate、rebuild 和两种文件下载，均通过 |
| Three.js STLLoader 加载经代理下载的文件 | 12 个三角面，包围盒 100×60×10 mm |
| STEP 测试文件几何检查 | SDK import_step(require_single_root=True, require_valid=True) 成功 |
| 完整干净环境 `sca run course_project/workspace/u_link.py --no-cache --out course_project/outputs/u_link-v02-clean` | 13 个单元均 ran，退出码 0；上游仍有两条面法向警告 |
| 原编辑器页面 / API 健康检查 | 7180 返回 200；8000 为 mock/mock，real_ai_available=false |

测试覆盖无内核 Mock 进程、真实 CAD 回归、固定模型尺寸披露、四种模式组合的调用边界、请求与响应 Schema、数据文件缺失/损坏、404/405、未实现 AI、解析器失败及其他未处理异常的 JSON 响应。
真实 AI 组合使用测试函数验证扩展点，没有调用任何真实供应商；不得将其描述为真实 AI 验收通过。

尚未验证：浏览器三维交互视觉效果、WebSocket 全流程、源码 C++ 编译、生产反向代理、跨操作系统安装、老师飞书任务要求。现有测试客户端有 httpx 弃用提示，不影响本次结果。
本地验收阶段未冻结公共协议、未邀请组员、未创建功能分支、未合并/推送/创建 V0.2.0 标签。用户随后授权保存发布，版本管理结果以 Git 记录为准。

## V0.1.0 原始记录

日期：2026-11-27。环境：Windows x64 / Python 3.13.9。

- 小组测试：8 passed，包含真实 CAD STEP/STL 导出、HTTP 下载、UUID 不覆盖、参数与错误分支。
- 官方 u_link 示例：13 个单元全部 ran，输出产品包至 outputs/u_link。上游打印两条面法向方向警告，运行退出码为 0。
- 原始编辑器：127.0.0.1:7180 返回 HTTP 200。
- 小组 API：127.0.0.1:8000/health 返回 status=ok、ai_mode=mock、cad_mode=real。
- 实际 POST rebuild 成功，响应保存为 mock/response.example.json。该文件的 UUID 仅演示响应格式，其他机器需自己发送请求生成文件。
- marimo 固定 0.25.2，避免 SDK 对 0.26 的兼容警告。
- Starlette 测试客户端提示 httpx 即将弃用，目前测试通过；升级框架时应复核测试客户端依赖。

尚未验证：源码 C++ 编译、前端源码 npm 构建、浏览器三维交互的视觉效果、真实 AI 服务、飞书任务书和参考云平台。当前验证的是官方同版本二进制运行基线及小组业务接口。

服务以本机后台进程启动，日志位于 course_project/outputs/。关闭服务可在 PowerShell 中查端口所属进程后停止对应 PID；不要批量停止所有 Python 进程。
