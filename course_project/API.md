# 小组接口 v1（V0.2.0 补充响应协议，待共同确认）

API 默认 http://127.0.0.1:8000 。原有合法请求保持兼容，长度 mm，右手坐标系、Z 向上、长方体底面中心在原点。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | /health | 模式及 real_ai_available；status=ok 只表示服务响应，不代表真实 AI 已接入 |
| POST | /api/v1/generate | GenerateRequest：`{"prompt":"生成长方体"}` |
| POST | /api/v1/rebuild | ModelSpec，见 mock/model_spec.json；跳过 AI |
| GET | /api/v1/files/{model_id}/{format} | 下载 stl 或 step |

目前只支持 box。parameters 的 length/width/height 为 JSON 数字（拒绝字符串及布尔值），范围 (0,10000]，拒绝未知字段；prompt 去除首尾空白后为 1–2000 字符。
schema_version 默认 1.0，unit 默认 mm，保持已有请求兼容。

## 成功响应 GenerateResponse

沿用 success=true、model_id(UUID)、schema_version、model_type、unit、parameters、files、warnings、error=null。
新增字段：

| 字段 | 含义 |
| --- | --- |
| cad_mode | mock 或 real，说明模型来源 |
| ai_mode | generate 时为 mock/real；rebuild 为 null |
| requested_spec | Mock CAD 时保存请求尺寸；真实 CAD 时为 null |

parameters 始终描述下载文件的实际几何。Mock CAD 固定返回 100×60×10 mm 文件，warnings 明确标注模拟，绝不承诺按请求重新建模。
files 是 HTTP 相对 URL，由后端生成；前端经 Vite 代理使用，禁止把其当成本地路径。每次生成独立 UUID；旧文件保持可下载，只要输出目录还在。
业务生成与原笔记本工作区相互独立，本版本不把生成文件自动写入原编辑器的可编辑笔记本。

## 内部协议 CadResult

`generate_model(spec: ModelSpec, output_dir: Path) -> CadResult` 是真实 CAD 入口。
结果包含 model_id、spec（实际几何）、files.stl/files.step（Path）、cad_mode、warnings。CAD 不返回 HTTP 地址；后端负责响应模型和下载路由。
Mock 实现只复制 mock/demo.stl/demo.step，启动及调用均不导入内核。
CAD 导出暂依赖固定版本 kernel.ocp_export，SDK 升级时需重新验收。

## 错误响应 ErrorResponse

所有业务错误与未处理异常统一为：
`{"success":false,"model_id":null,"files":null,"error":{"code":"INVALID_REQUEST","message":"说明"}}`。
内部异常堆栈只写服务日志，不返回浏览器。

| HTTP | 错误码 | 场景 |
| --- | --- | --- |
| 422 | INVALID_REQUEST | JSON/参数校验失败 |
| 500 | DEMO_DATA_ERROR | Mock AI 参数文件缺失或损坏 |
| 500 | CAD_BUILD_FAILED | 内核、导出或 Mock 模型文件读取失败 |
| 501 | AI_NOT_IMPLEMENTED | real 模式未注入真实解析器 |
| 502 | AI_SERVICE_ERROR | 解析器失败或结果不符合 ModelSpec |
| 404 | MODEL_NOT_FOUND / FILE_NOT_FOUND | UUID 无效、文件或格式不存在 |
| 404 | NOT_FOUND | 路由不存在 |
| 405 | HTTP_ERROR | 方法不支持 |
| 500 | INTERNAL_ERROR | 其他未处理异常 |

配置值非法会在启动时失败，不静默回退到 mock。

## 机器可读协议

contracts.py 是协议来源；`python -m course_project.export_schemas` 同步五份文件：
model_spec、generate_request、cad_result、generate_response、error_response.schema.json。
JSON Schema 检查结构，Python 响应模型额外检查 URL 中 UUID 与 model_id 一致；客户端也应使用响应中的实际地址。
样例：mock/model_spec.json、response.example.json、error.example.json。响应样例中的 UUID 仅作示意，文件下载必须先实际生成。
各协议的未知字段均拒绝；扩展模型类型、响应字段或错误语义前共同评审。
