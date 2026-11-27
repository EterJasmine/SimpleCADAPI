# 初始工程验证记录

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
