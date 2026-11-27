# 小组公共初始工程

源码基线：`389d430667679d5fda3188956b023542aa4237f2`，SDK 2.3.0.post1。
小组仓库：https://github.com/EterJasmine/SimpleCADAPI ，上游：https://github.com/PhySpace/SimpleCADAPI 。
公共集成分支：`develop`。暂不邀请组员、暂不建立三人的功能分支。

## Windows 启动

在仓库根目录使用 PowerShell。已验证环境为 Python 3.13.9 / Windows x64。

```powershell
./course_project/setup.ps1
# 第一次复制官方示例（后续无需重复）
./.venv/Scripts/sca.exe example u_link course_project/workspace
./course_project/start.ps1 editor
# 另一个终端启动小组接口
./course_project/start.ps1 api
# 自动验证
./course_project/start.ps1 test
```

编辑器：http://127.0.0.1:7180 ，接口健康检查：http://127.0.0.1:8000/health 。
如果本机执行策略禁止 ps1，可直接运行脚本中对应的 `.venv/Scripts` 命令。
安装不需要激活虚拟环境，不需要配置 API Key。依赖完整版本在 requirements.lock.txt 中。
macOS/Linux 用 `python3 -m venv .venv`，再使用 `.venv/bin/python` 和 `.venv/bin/sca` 执行相同命令；当前锁文件以 Windows 环境验证。

## 结构与协作

| 成员 | 优先负责 | 接入边界 |
| --- | --- | --- |
| A | course_project/cad.py、建模模板 | 接收 ModelSpec，返回结果及下载地址 |
| B（组长） | course_project/backend.py、环境与集成 | AI 解析、HTTP 服务、异常处理 |
| C | editor-web/src、前端交互 | 复用原有 React/TypeScript/Three.js 编辑器 |
| 全员评审 | course_project/contracts.py、mock/ | 修改字段与单位前共同确认 |

`src/simplecadapi/` 是原 SDK，`src/cpp/` 是几何内核，`editor-web/` 是原网页，`scene-contract/` 是上游场景协议；小组 ModelSpec 是业务输入，不替代上游场景协议。

本次采用官方同版本二进制安装包运行。**修改仓库 src/ 不会自动影响安装包。**
需要修改 SDK 时按 pyproject.toml 的构建说明执行源码可编辑安装（`uv pip install --python .venv/Scripts/python.exe -e '.[editor]'`），涉及 C++ 工具链与 OCCT 编译，完成后检查 `simplecadapi.__file__`。
前端源码开发进入 editor-web，使用 npm ci，再 npm run typecheck / npm test / npm run build；构建目录由 vite.config.ts 指向源码包，必须搭配源码安装才能由编辑器加载。不要误以为构建会更新已安装的 wheel。

## 当前功能与下一步

已复用上游参数化建模、笔记本编辑器、三维展示及导出能力；小组接口先用真实长方体走通建模和下载。
POST generate 为显式模拟解析：无论文字内容均生成固定长方体，响应 warnings 会提示；POST rebuild 使用请求中的实际尺寸。
下一阶段候选：A 增加四孔安装板及几何约束；B 接真实 AI 并强化解析错误提示；C 增加参数表单及生成状态显示。候选待组内确认，不代表老师硬性要求。
飞书浏览器连接失败，课程任务书与参考云平台尚未核验，不能将候选优化视为已确认课程需求。

## Git 协作

从 develop 建立 feature/cad、feature/backend、feature/frontend，完成各模块验证后向本组 develop 提 PR；集成验证后再合 main。origin 指向本组，upstream 只用于拉取老师更新。不要把密钥、模型输出或虚拟环境提交。
公共初始版本使用 `course-v0.1.0` 标签；新成员从本组 `develop` 获取工程。
