# 小组公共工程 V0.2.0

小组仓库：https://github.com/EterJasmine/SimpleCADAPI 。老师仓库仅作为上游读取，不向其推送。
上游源码基线：`389d430667679d5fda3188956b023542aa4237f2`，SDK 2.3.0.post1。
公共集成分支：`develop`，本版标识：`course-v0.2.0`。原始基线 `course-v0.1.0` / `aaabdaf` 保留。
修复来源：`fix/baseline-readiness`；V0.2.0 已完成本地验收并获准保存发布。暂不邀请组员、不创建三个功能分支。

## 安装与启动

统一 **Python 3.13 x64**，前端验证环境 Node.js 24.14.1。以下命令均从仓库根目录执行，无需激活虚拟环境。

```powershell
# 完整安装：原 SDK、编辑器和小组服务
./course_project/setup.ps1
# 首次复制示例，已有工作区不要重复覆盖
./.venv/Scripts/sca.exe example u_link course_project/workspace
./course_project/start.ps1 editor
# 另一个终端，默认 AI/CAD 都为 mock
./course_project/start.ps1 api -AiMode mock -CadMode mock
# 测试（含真实建模，需要完整安装）
./course_project/start.ps1 test
```

编辑器 http://127.0.0.1:7180 ，小组健康检查 http://127.0.0.1:8000/health 。
setup 在安装前检查解释器版本、位数和已有虚拟环境；不兼容时停止，不覆盖现有环境。
可用 `-PythonCommand 'C:/path/to/python.exe'` 指定解释器，`-VenvPath sandbox-envs/my-env` 指定另一个环境。start 同样接受 VenvPath。
锁文件为 Python 3.13/Windows x64 验证版本，不宣称支持其他 Python 版本或平台。
若本机策略禁止 ps1，使用脚本中对应的 python/sca 命令，不必改变系统执行策略。

## 模式切换与独立开发

```powershell
# A：Mock AI + 真实 CAD
./course_project/start.ps1 api -AiMode mock -CadMode real
# B/C：不需要 CAD SDK 的最小环境（新终端使用此环境启动 API）
./course_project/setup.ps1 -VenvPath sandbox-envs/mock -MockOnly
./course_project/start.ps1 api -VenvPath sandbox-envs/mock -AiMode mock -CadMode mock
```

也可使用 `$env:AI_MODE='mock'; $env:CAD_MODE='real'` 后执行 `python -m uvicorn course_project.backend:app --host 127.0.0.1 --port 8000`。
设置在服务启动时读取，修改后须重启；默认均为 mock。MODEL_OUTPUT_DIR 可设置输出目录。
本工程不自动读取 .env，不要把 API Key 写进代码或提交到仓库。

| AI_MODE | CAD_MODE | 当前行为 |
| --- | --- | --- |
| mock | mock | 固定参数 + 复制测试模型，完全不导入 CAD 内核 |
| mock | real | 固定参数 + 真实几何生成和导出 |
| real | mock | AI 扩展点 + 固定测试模型；未注入解析器时 generate 返回 501 |
| real | real | AI 扩展点 + 真实 CAD；未注入解析器时 generate 返回 501 |

B 的扩展点是 `ai_service.Parser`：同步函数 `(prompt: str) -> ModelSpec`，通过 `create_app(settings, ai_parser=...)` 注入，服务会放在线程池执行并校验返回值。可在 B 自己的入口模块暴露 app 后用 uvicorn 启动。
尚未接入真实模型供应商；测试解析器只验证接入边界，不代表已验证真实 AI。rebuild 不调用 AI，在四种配置下均可用。

Mock 文件由上游 SDK 2.3.0.post1 一次性导出，固定为 100×60×10 mm 长方体，Z 向上、底面中心位于原点。
每次 Mock 请求复制文件到新 UUID 目录，下载地址真实有效；返回 cad_mode=mock 和 warnings，parameters 描述实际固定几何，requested_spec 保存请求参数。
mock/response.example.json 仅示范响应结构，其 UUID 不预装到输出目录；先 POST 请求获取当前机器的下载地址。demo.stl/demo.step 是可直接使用的测试文件。

## 前端开发与代理

```powershell
cd editor-web
npm ci
npm run dev
# 其他检查
npm run typecheck
npm test
npm run build
```

开发页面通常为 http://127.0.0.1:5180 。需要同时启动原编辑器 7180 和业务服务 8000 才能使用两个服务的全部功能；C 开发业务面板和模型加载时可仅启动 Mock API。
Vite 按顺序转发 `/api/v1`（包括下载）到 8000，原有 `/api` 与 `/ws` 保持到 7180；业务前端使用返回的相对下载 URL，不硬编码本地文件路径。
源码 UI 的开发反馈可用 Vite，无需先编译 C++。

完整安装使用官方同版本 wheel，**修改仓库 src/ 不会自动影响该安装包**。
修改 SDK 时按上游 pyproject.toml 和 tools/build_backend 说明执行可编辑源码安装：`uv pip install --python .venv/Scripts/python.exe -e '.[editor]'`，涉及 C++/OCCT 构建，完成后检查 `simplecadapi.__file__`。
前端生产构建输出到 src/simplecadapi/editor/webui；需搭配源码安装才能由编辑器加载。Vite 开发代理不等于生产部署反向代理，后者留待集成阶段配置。

## 协作边界与验收

| 成员 | 负责范围 | 可独立执行 |
| --- | --- | --- |
| A | cad.py、建模模板与几何测试 | ModelSpec → CadResult，无需 AI 和 HTTP 服务 |
| B | ai_service.py、backend.py、配置和集成 | 注入解析器，使用 Mock CAD，不等待 A 扩展几何 |
| C | editor-web/src 的业务交互 | Mock API + 可下载模型，不等待真实 AI/CAD |
| 全员共同确认 | contracts.py、Schema、API.md、mock/ | 扩展模型种类前先对齐字段与单位 |

```powershell
./.venv/Scripts/python.exe -m pytest course_project/tests -q
./.venv/Scripts/python.exe -m course_project.export_schemas
# 启动 Mock API 和原编辑器，安装 editor-web 依赖后验证真实代理/模型加载
node course_project/verify_proxy.mjs
```

协议见 API.md，已执行的检查及限制见 VALIDATION.md。正式接口尚未冻结，需共同确认。
公共分支为 develop，稳定分支为 **master**。后续功能分支和合并须在本地验收及确认后进行。
老师飞书任务书仍待核验；不将当前候选功能视为老师的考核要求，不在本次修复同步上游源码。
