# 小组接口 v1

默认地址 http://127.0.0.1:8000 。长度 mm，右手坐标系、Z 向上，长方体底面中心位于原点。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | /health | 服务状态及 AI/CAD 模式 |
| POST | /api/v1/generate | `{ "prompt": "演示长方体" }`，演示解析后真实建模 |
| POST | /api/v1/rebuild | 接收 mock/model_spec.json 同结构的 ModelSpec，真实重建 |
| GET | /api/v1/files/{model_id}/{format} | 下载 step 或 stl |

当前只支持 box；parameters 的 length、width、height 必须是 JSON 数字，范围 (0,10000]；不接受额外字段。prompt 去除首尾空白后 1–2000 字。
机器可读规范：model_spec.schema.json。mock/model_spec.json 可直接用作 rebuild 请求。

成功响应包含 success=true、model_id(UUID)、schema_version、model_type、unit、parameters、files、warnings、error=null。files 内是 HTTP 相对地址，前端与本服务同源或配置开发代理后使用；不返回本地路径。
每次重建返回新的 UUID，不覆盖旧模型。输出仅存本机 course_project/outputs，重启后仍可按 UUID 下载。
失败响应为 `{ "success": false, "model_id": null, "files": null, "error": {"code": "INVALID_REQUEST", "message": "说明"} }`。
422 INVALID_REQUEST：输入不合法；404 MODEL_NOT_FOUND/FILE_NOT_FOUND：下载目标无效；500 CAD_BUILD_FAILED：建模或导出失败。内部异常记录服务端日志。

cad.py 暂时封装 SDK 的 kernel.ocp_export 导出工具；这是与固定版本绑定的适配点，升级 SDK 时须重新执行真实文件导出测试。
后续模型类型由三人共同扩展 contracts.py，再生成 schema 和样例，前后端按同一提交开发。
