# V0.2.0 公共基础工程修复报告

日期：2026-11-27。结论：F01–F09 已完成本地修复，独立开发基础验证通过。用户随后确认保存并发布 V0.2.0；提交、合并和标签以 Git 记录为准。

## 修改内容

| 任务 | 文件 | 功能 |
| --- | --- | --- |
| F01 | editor-web/vite.config.ts、verify_proxy.mjs | /api/v1 优先转发 8000，保留原 /api、/ws 到 7180；通过真实请求验证生成、重建、下载和原工作区接口 |
| F02 | config.py、ai_service.py、mock_cad.py、backend.py | AI/CAD 独立模式设置，默认 mock/mock；真实 AI 预留可注入的解析器入口 |
| F03 | mock/demo.stl、demo.step、响应样例、.gitignore | 提交固定真实模型；Mock 每次复制到新 UUID，文件可下载、可由 Three.js 加载 |
| F04 | setup.ps1、requirements.mock.in、start.ps1、README.md | 统一 Python 3.13 x64；检查已有环境；提供不安装 SDK 的最小环境及启动参数 |
| F05 | errors.py、backend.py | 统一 JSON 业务异常、路由异常与未知异常；不暴露内部堆栈 |
| F06 | cad.py、backend.py | CAD 仅返回文件 Path 等内部产物；HTTP 地址由后端构造 |
| F07 | contracts.py、五份 *.schema.json、export_schemas.py、API.md | 新增 CadResult、GenerateResponse、ErrorResponse；支持确定性重新生成和一致性测试 |
| F08 | tests/test_baseline.py、test_readiness.py、test_setup.py | 保留原 8 项测试行为，扩展为 39 项；增加实际代理/模型加载验收脚本 |
| F09 | README.md、API.md、VALIDATION.md | 稳定分支修正为 master，补充模式、分工、安装、接口测试及验证边界 |

以上路径除 editor-web 与 .gitignore 外均相对 course_project。

## 架构差异

修复前：generate 内嵌模拟解析且必经真实 CAD；CAD 返回 HTTP URL；前端所有 /api 指向原编辑器；响应为无类型字典。

修复后：请求 → 请求模型校验 → 独立 AI 解析入口（rebuild 跳过）→ Mock/Real CAD → CadResult 内部产物 → 后端构造并校验 GenerateResponse → 下载路由。原编辑器服务保持独立。
Mock CAD 只复制已提交的资源，连 SDK 都不需要安装；固定几何的尺寸独立于可编辑的 Mock AI 请求样例，避免调整样例后误报模型尺寸。

## 协议变化与兼容性

- 已有 ModelSpec 和 GenerateRequest 合法输入保持兼容，仍只支持 box；没有增加其他成员应实现的零件或 AI 供应商功能。
- 成功响应沿用原字段，补充 ai_mode、cad_mode、requested_spec。parameters 描述实际几何；Mock 时 requested_spec 描述请求，warnings 明示固定模型。
- CadResult 作为内部协议返回 UUID、ModelSpec、STL/STEP Path 和来源，不承担 HTTP 路由职责。
- 所有已覆盖的预期错误均为 ErrorResponse；AI real 未接入时返回 501，不静默模拟。
- Schema 与 Python 类型比较通过；Python 额外检查 URL 与 model_id 一致。公共协议仍待三人共同确认，未冻结。

## 实际测试结果

完整干净环境通过 39 项后端测试，包含原有 8 项；最小无 SDK 环境通过 24 项相关测试（5 项真实能力测试被明确排除）。两种干净环境均实际启动 Uvicorn 并完成生成和双文件下载，pip check 无冲突。
前端类型检查、331 项测试和生产构建通过。实际 Vite 代理连通原编辑器及业务 API；STLLoader 读取 12 个三角面与正确尺寸；STEP 可作为有效单根几何导入。
官方 U 形连杆在完整干净环境禁用缓存重跑，13 个单元全部 ran，退出码 0。详细命令、警告及未验证范围见 VALIDATION.md。

## 独立开发结论

| 成员 | 结论 | 约束 |
| --- | --- | --- |
| A | 可脱离 AI/HTTP 开发 | 基于 ModelSpec → CadResult，在 CAD_MODE=real 验证新几何 |
| B | 可脱离真实 CAD 开发 | 在最小环境使用 Mock CAD，向 create_app 注入自己的解析器；真实供应商功能未实现 |
| C | 可脱离真实 AI/CAD 开发业务前端 | Mock API 提供实际模型下载；若涉及原编辑器笔记本功能，还需启动原编辑器服务 |

生成 STEP/STL 不会自动成为原编辑器的可编辑笔记本，这项集成需后续技术路线单独确认。

## Git 状态与发布边界（本地验收时快照）

当前分支 fix/baseline-readiness，修复保留在工作区，尚未提交。develop 仍为 aaabdaf，course-v0.1.0 保持原指向。
此快照记录授权发布前的状态：未向任何远端推送、未合并、未创建 course-v0.2.0 标签、未创建正式功能分支、未邀请组员。后续发布按用户确认进行；不邀请组员、不创建正式功能分支的边界继续保留。

## 剩余事项和风险

1. 老师飞书任务书尚未核验，不能据此宣称符合全部课程考核要求。
2. 需要三人共同确认公共接口，随后再冻结和建立正式功能分支。
3. 真实 AI 尚未接入；四种模式测试中的 real AI 使用测试解析器验证调用边界。
4. 跨平台安装、源码 C++ 编译、生产反向代理及浏览器视觉交互未验收；前端构建不自动替换已安装 wheel 的静态页面。
5. 上游示例仍有面法向警告，前端有较大构建包提示，Starlette 测试客户端有 httpx 弃用提示；本次未改动这些上游行为。

工程修复已具备进入共同评审的条件；课程要求核验和协议共同确认仍是正式并行开发前的待办事项。
