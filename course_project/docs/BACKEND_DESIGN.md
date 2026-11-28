# CAD Agent 后端与 Agent 编排设计文档

**Agent 与后端模块设计说明（HTTP 服务、任务编排、LLM 接入、会话与版本）**

---

## 1. 文档定位

### 1.1 目的

本文描述 CAD Agent 系统中「Agent 与后端」这一层的设计方案，覆盖 HTTP 服务、会话与任务管理、LLM 接入、需求理解与澄清、建模计划调度、几何检测调用、自动修复、版本发布与产物管理。

文档面向三类读者：

- 前端工作台负责人：需要确认 HTTP 接口、状态语义、轮询节奏与文件下载路径；
- CAD 适配层负责人：需要确认工具契约的调用形态、坐标系语义、检测请求与返回结构；
- 课程评阅：需要确认系统设计、模块边界、自主开发范围与测试方案。

### 1.2 与组内既有文档的关系

| 文档 | 作用 | 本文的位置 |
| --- | --- | --- |
| `docs/技术文档V2.0` | 系统级总体设计、六层架构、三组实验案例、验收清单 | 本文是其第 6、7、8、9、12、13、14、15 章的落地实现说明 |
| `docs/CAD Agent 公共接口与数据协议规范` | 跨模块数据契约（坐标系、状态枚举、HTTP API、计划 IR、检测协议） | 本文逐条实现，并对规范未覆盖处补充定义（见 5.9、15.3、19 章） |
| `course_project/API.md` | V0.2.0 已有 `/api/v1/generate`、`/rebuild`、`/files` 协议 | 本文不改动该协议，新增接口独立挂载于 `/api/v1/agent` |
| `editor-web/src/agent/contracts.ts`、`api.ts` | 前端已实现的运行时类型守卫与调用方式 | 本文第 15.4 节逐字段核对，作为接口冻结依据 |

本文以**模块名称**指代职责，与《技术文档V2.0》第 21 章的分工一一对应：CAD 适配层、Agent 与后端、前端工作台。

### 1.3 基线

| 项目 | 值 |
| --- | --- |
| 小组仓库 | `EterJasmine/SimpleCADAPI` |
| 公共集成分支 | `develop` |
| 公共基线提交 | `a6d4120`（合并 V0.2.0 并行开发基线） |
| 版本标识 | `course-v0.2.0` |
| 上游 SDK 基线 | `389d430`，SDK 2.3.0.post1 |
| 后端运行时 | Python 3.13 x64，Starlette + Uvicorn + Pydantic v2 |
| 前端验证环境 | Node.js 24.14.1，React 19 + Vite |

V0.2.0 已通过本地验收：完整环境 39 项测试、最小无 CAD 环境 24 项测试、前端 331 项测试。本文新增的 Agent 业务属于 V0.3.0 范围，不与上述既有测试结果混算。

### 1.4 术语

| 术语 | 含义 |
| --- | --- |
| 会话 `session` | 用户与 Agent 的连续交互上下文，包含多条消息、多个任务与多个模型版本 |
| 任务 `task` | 一条用户消息触发的一次完整处理，有独立状态机与执行事件流 |
| 尝试 `attempt` | 一次完整的几何建模执行，索引从 0 开始，每次尝试使用独立的几何上下文 |
| 修复 `repair` | 依据失败反馈修订建模计划并重新执行，计数从 0 开始 |
| 计划 `ModelingPlan` | 建模中间表示，由有序工具步骤与参数组成（规范第 9 章） |
| 工具调用 `ToolCall` | 计划中单个步骤解析后提交给 CAD 适配层的执行请求 |
| 检测 `inspection` | 从真实几何实体提取尺寸与拓扑事实，与已确认需求逐项比对 |
| 版本 `version` | 一次验收通过并被发布的不可变模型产物集合 |

### 1.5 范围

**本版实现（P0）**

自然语言需求理解、关键参数缺失与冲突时的澄清、单零件建模计划生成与校验、真实工具调度、真实几何检测、基于检测反馈的自动修复、同一会话内多轮修改、模型版本发布与文件导出、执行事件日志、任务取消与超时控制、三组实验运行支撑。

**本版预留（P1）**

工具清单接口对前端的完整暴露、源码在线查看、参数滑块后端支持、历史版本对比的后端查询优化。

**明确不在本模块**

几何内核调用与工具实现、STL/STEP 生成算法、三维渲染、装配建模、图片输入、建模经验复用。

---

## 2. 职责边界

### 2.1 本模块承担

1. **HTTP 服务层**：路由、请求校验、响应序列化、统一异常处理、静态资源与文件下载。
2. **业务服务层**：会话服务、任务服务、版本服务、产物服务。
3. **Agent 编排层**：端到端主流程控制，包括需求理解、澄清判定、计划生成、计划校验、执行调度、检测调用、修复决策、版本发布。
4. **LLM 接入层**：统一客户端协议、供应商适配、结构化输出约束、重试与超时。
5. **任务运行时**：任务队列、单会话互斥、执行预算、取消协作、崩溃恢复。
6. **存储层**：SQLite 元数据、文件系统产物目录、执行事件日志。
7. **公共契约**：`agent_contracts.py` 作为跨模块数据类型的唯一权威来源，并负责导出 JSON Schema。

### 2.2 本模块不承担

- 不实现任何几何算法，不直接导入 `simplecadapi` 内核（仅通过 `CADBackend` 协议调用）。
- 不生成 STL/STEP 的三角化与写出逻辑。
- 不实现前端渲染、相机适配与交互。
- 不实现用户登录与权限体系（单用户本地工作台）。
- 不实现分布式任务队列与多机调度。

### 2.3 依赖方向

```text
前端工作台 (editor-web)
    |  HTTP /api/v1/agent
    v
api/  (路由与序列化)
    |
    v
services/  (会话、任务、版本、产物)
    |
    v
agent/  (编排、LLM、规划、修复)
    |
    v  CADBackend 协议（Python 调用，非 HTTP）
cad_tools/  (CAD 适配层，由 CAD 适配层负责人实现)
    |
    v
SimpleCADAPI
```

约束：

- 依赖只能向下，不得反向。`agent_contracts.py` 可被任意层引用，但其自身不得依赖 `services/`、`agent/`、`cad_tools/`。
- `services/` 不得导入 `cad_tools`；对几何能力的一切访问都经过 `CADBackend` 协议注入。
- 路由函数不得包含建模业务逻辑，只做「校验 → 调服务 → 序列化」。

### 2.4 两类接触面

| 接触面 | 对方 | 形态 | 变更方式 |
| --- | --- | --- | --- |
| HTTP 契约 | 前端工作台 | JSON over HTTP，`schema_version = "2.0"` | 每次变更需双方确认并同步 `contracts.ts` |
| 工具契约 | CAD 适配层 | Python `CADBackend` 协议 + Pydantic 模型 | 由 `agent_contracts.py` 定义，双方共同评审 |

---

## 3. 运行时架构

### 3.1 进程与线程模型

```text
uvicorn 单进程
├── 事件循环（asyncio）
│   └── HTTP 路由：只做校验与响应，不阻塞
├── 任务执行线程（ThreadPoolExecutor，max_workers=2）
│   └── Agent 编排主流程（同步实现，便于复现与调试）
├── CAD 调用线程（与任务线程同一池，几何调用在锁内串行）
│   └── CADBackend.execute_tool
└── 事件写入队列（单写线程，追加 JSONL 与 SQLite）
```

设计要点：

1. **HTTP 与建模解耦**。提交接口立即返回 202，建模在后台线程执行，前端通过轮询获取状态。这满足规范第 6.6 节「成功响应 HTTP 202」。
2. **编排流程写成同步函数**。LLM 调用是阻塞 HTTP 请求，CAD 调用是阻塞本地计算，用同步实现比全异步更容易保证顺序、超时与复现；对外仍由 `run_in_threadpool` 包装，不阻塞事件循环。这与 V0.2.0 中 `backend.py` 已有的 `run_in_threadpool` 用法一致。
3. **SQLite 单写者**。所有写操作经过同一个写锁与短事务，开启 WAL 与 `busy_timeout`，避免并发写导致的 `database is locked`。
4. **CAD 调用串行化**。SimpleCADAPI 的原生录制上下文在进程内共享（V0.2.0 的 `cad.py` 已用 `_kernel_lock` 串行化），因此同进程内几何操作必须串行，线程池的作用是隔离 HTTP 等待而非并行几何计算。

### 3.2 与 V0.2.0 基线的并存方式

`backend.py` 中现有四条路由保持不变：

```text
GET  /health
POST /api/v1/generate
POST /api/v1/rebuild
GET  /api/v1/files/{model_id}/{format}
```

新增内容以独立路由组挂载，前缀 `/api/v1/agent`：

```python
# backend.py 的 create_app 内追加，既有路由不改动
from .api.agent_routes import routes as agent_routes, agent_error_handlers
app.routes.extend(agent_routes)
```

异常处理沿用基线的三层结构（`ServiceError`、`HTTPException`、兜底 `Exception`），新增 `AgentError` 作为业务异常基类，映射为规范第 6.6 节的统一错误体。基线现有的 `INVALID_REQUEST`、`MODEL_NOT_FOUND`、`FILE_NOT_FOUND`、`INTERNAL_ERROR` 语义继续有效，`/api/v1/agent` 下的错误码见附录 A。

### 3.3 框架选择（决策 D1）

**结论：继续使用 Starlette + Pydantic，不引入 FastAPI。**

理由：

1. V0.2.0 的错误响应形状依赖 Starlette 的 `exception_handlers` 三层结构；换用 FastAPI 后 `RequestValidationError` 会产生 FastAPI 默认的 422 体，与既有 `ErrorResponse` 结构冲突，需要额外重写异常处理才能保持兼容。
2. 规范第 4.3 节要求「Pydantic 作为唯一权威来源 → JSON Schema → OpenAPI → TypeScript」。该链路可以独立于 Web 框架实现：由 `export_schemas.py` 导出 JSON Schema，前端若需 OpenAPI 可后续单独生成，不构成本阶段的阻塞项。
3. 新增依赖会改变 `requirements.lock.txt`，与已验收的 V0.2.0 环境产生差异，增加三端联调的变量。

影响与对策：

- 路由声明为显式 `Route` 列表，参数校验统一在服务层入口用 Pydantic `model_validate` 完成，错误统一抛 `AgentError`。
- 该决策需在公共基线上由三人共同确认后生效，若组内统一要求 FastAPI，则映射关系为：`Route` → `APIRouter`，`exception_handlers` → `add_exception_handler`，响应体仍复用同一套 Pydantic 模型，接口形状不变。

### 3.4 提交与执行的路径

```text
POST /sessions/{id}/messages
  ├─ 1. 校验 schema_version / 请求体 / client_request_id 格式
  ├─ 2. 幂等检查（requests 表）
  ├─ 3. 会话存在性与忙碌检查（活跃任务唯一索引）
  ├─ 4. base_version_id 与 current_version_id 一致性检查
  ├─ 5. 写入 message(user) + task(queued)，绑定 active_task_id
  ├─ 6. 返回 202 {session_id, task_id, message_id, status:"queued"}
  └─ 7. 投递到任务执行线程

任务线程
  understanding → planning → executing → inspecting → exporting → completed
                     ↑            ↓            ↓
                     └──── repairing ←────────┘
```

---

## 4. 模块结构

```text
course_project/
├── agent_contracts.py          # 公共协议：Pydantic 模型与枚举（唯一权威来源）
├── agent_errors.py             # AgentError 及错误码常量
├── config.py                   # 扩展：新增 LLM 与预算相关配置项
├── backend.py                  # 扩展：挂载 agent 路由与异常处理
├── export_schemas.py           # 扩展：同时导出 agent_*.schema.json
│
├── api/
│   ├── __init__.py
│   ├── agent_routes.py         # /api/v1/agent 路由汇总与异常映射
│   ├── session_routes.py       # 会话与消息
│   ├── task_routes.py          # 任务状态、事件、取消
│   └── artifact_routes.py      # 版本详情、文件下载、工具与配置
│
├── services/
│   ├── __init__.py
│   ├── session_service.py      # 会话创建、列表、详情、消息读写
│   ├── task_service.py         # 任务创建、状态组装、取消、预算
│   ├── version_service.py      # 版本发布、查询、序号分配
│   └── artifact_service.py     # 产物路径解析、格式白名单、下载
│
├── agent/
│   ├── __init__.py
│   ├── orchestrator.py         # CADAgent 主流程
│   ├── state_machine.py        # 状态转换合法性守卫
│   ├── llm_client.py           # LLMClient 协议 + DeepSeek/Mock 适配
│   ├── requirements.py         # 需求增量更新与校验
│   ├── clarification.py        # 澄清问题生成与合并
│   ├── constraints.py          # 确定性几何约束检查
│   ├── planner.py              # 计划生成
│   ├── plan_validator.py       # 计划静态校验
│   ├── executor.py             # execute_plan 调度
│   ├── repair.py               # 修复决策与停滞检测
│   ├── budget.py               # 执行预算与取消标记
│   ├── events.py               # 执行事件写入与游标
│   └── prompts/
│       ├── requirements.md
│       ├── planning.md
│       ├── repair.md
│       └── revision.md
│
├── storage/
│   ├── __init__.py
│   ├── database.py             # 连接、WAL、迁移、事务
│   └── repository.py           # 各表读写
│
├── schemas/                    # 由 export_schemas.py 生成，纳入版本管理
│   ├── agent_request.schema.json
│   ├── agent_response.schema.json
│   ├── modeling_plan.schema.json
│   ├── tool_call.schema.json
│   └── inspection.schema.json
│
├── mock/
│   ├── mock_agent.py           # Mock LLM：固定需求/计划/修复响应
│   ├── mock_cad.py             # 既有：Mock CAD，复制固定产物
│   └── scenarios/              # 三组实验的可复现场景数据
│
└── docs/
    └── BACKEND_DESIGN.md       # 本文
```

模块职责要点：

- `orchestrator.py` 只负责「决定下一步做什么」，不直接读写数据库，也不直接调用 CAD；数据写入走 `services/`，几何调用走 `CADBackend`。
- `events.py` 是执行事件的唯一写入点，保证 `event_id` 按任务单调递增。
- `plan_validator.py` 与 `repair.py` 共用同一套校验入口，修复产出必须走完整校验才能执行。

---

## 5. 公共数据契约

### 5.1 单一来源与生成链

```text
agent_contracts.py（Pydantic v2，extra = "forbid"）
        ↓  python -m course_project.export_schemas
schemas/*.schema.json
        ↓  人工评审 + 字段核对脚本
editor-web/src/agent/contracts.ts
```

约定：

- 所有新增协议集中在 `course_project/agent_contracts.py`，V0.2.0 的 `contracts.py` 保持不动，避免破坏既有 `/api/v1/generate` 协议。
- 禁止 Python 类型、JSON Schema、TypeScript 类型三处各自定义不同字段。第 15.4 节给出当前 `contracts.ts` 与本文模型的逐字段核对结果，作为冻结依据。
- 所有模型禁止未声明字段（`extra="forbid"`），响应侧允许附加字段仅限顶层 `schema_version`。

### 5.2 会话

```python
class SessionStatus(StrEnum):
    IDLE = "idle"
    BUSY = "busy"
    AWAITING_INPUT = "awaiting_input"


class SessionSummary(BaseModel):
    session_id: UUID
    title: str
    status: SessionStatus
    current_version_id: UUID | None
    active_task_id: UUID | None
    created_at: datetime
    updated_at: datetime


class Session(SessionSummary):
    confirmed_requirements: RequirementState | None
    pending_requirements: RequirementState | None
    pending_questions: list[Question]
```

会话状态语义：

| 状态 | 进入条件 | 前端表现 |
| --- | --- | --- |
| `idle` | 无活跃任务、无待答问题 | 可提交新消息 |
| `busy` | 存在 `active_task_id` 且任务未终结 | 显示阶段、禁用重复提交 |
| `awaiting_input` | 最近一个任务以 `clarifying` 终结 | 展示待答问题卡片 |

`active_task_id` 与 `status` 必须同时更新：任务终结时两者在同一事务内改为 `None` 与 `idle`（或 `awaiting_input`）。若只改其一，前端 `busy` 推导会与实际不一致。

### 5.3 需求状态

```python
class ParameterSource(StrEnum):
    USER = "user"
    DERIVED = "derived"
    SUGGESTED = "suggested"
    DEFAULT = "default"


class ParameterValue(BaseModel):
    value: float | int | bool | str | None
    unit: str | None
    source: ParameterSource
    confirmed: bool
    required: bool


class Question(BaseModel):
    question_id: str
    field: str
    question: str
    expected_type: Literal["number", "integer", "string", "boolean"]
    unit: str | None
    suggested_value: float | int | bool | str | None
    required: bool


class ClarificationResult(BaseModel):
    questions: list[Question]


class RequirementState(BaseModel):
    part_name: str
    unit: Literal["mm"] = "mm"
    parameters: dict[str, ParameterValue]
    features: list[FeatureRef]
    constraints: list[ConstraintRef]
    missing_fields: list[str]
    conflicts: list[Conflict]
```

关键约束：

1. `confirmed=True` 只表示用户已明确确认，`source=user` 且 `confirmed=true` 的参数不允许被自动修复模块改写。
2. `suggested_value` 是建议值，不写入 `confirmed_requirements`；用户明确回复「按推荐值设计」后才转为 `confirmed=true`。
3. 必要参数为 `None` 或 `confirmed=false` 时不得进入真实建模，必须走澄清。
4. `RequirementState` 独立于 `ModelingPlan`：同一份需求可以对应多种建模方案，验收目标值一律取自 `RequirementState`。

### 5.4 任务与状态机

```python
class AgentTaskStatus(StrEnum):
    QUEUED = "queued"
    UNDERSTANDING = "understanding"
    CLARIFYING = "clarifying"
    PLANNING = "planning"
    EXECUTING = "executing"
    INSPECTING = "inspecting"
    REPAIRING = "repairing"
    EXPORTING = "exporting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
```

合法转换（`state_machine.py` 中作为白名单表实现，非法转换抛 `StateTransitionError` 并记 `error` 级事件）：

| 当前状态 | 触发 | 下一状态 |
| --- | --- | --- |
| `queued` | 调度开始 | `understanding` |
| `understanding` | 必要参数缺失或存在冲突 | `clarifying`（终结） |
| `understanding` | 需求完整 | `planning` |
| `planning` | 计划校验通过 | `executing` |
| `planning` | 计划校验失败且可修复 | `repairing` |
| `planning` | 计划校验失败且不可修复 | `failed`（终结） |
| `executing` | 全部步骤成功 | `inspecting` |
| `executing` | 工具失败且可修复 | `repairing` |
| `executing` | 工具失败且不可修复 | `failed`（终结） |
| `inspecting` | 全部必要检查 `passed` | `exporting` |
| `inspecting` | 存在失败检查且可修复、未超限 | `repairing` |
| `inspecting` | 存在失败检查且不可修复或超限 | `failed`（终结） |
| `repairing` | 产出修订计划 | `planning` |
| `exporting` | 产物完整发布 | `completed`（终结） |
| 任意运行态 | 收到取消请求 | `cancelling` |
| `cancelling` | 执行器在检查点确认停止 | `cancelled`（终结） |
| 任意运行态 | 任务总时限到达 / 未捕获异常 | `failed`（终结） |

两条硬约束：

1. 任务进入终结状态后不得被后续事件改回运行状态。
2. `clarifying` 是**任务**的终结状态，不是**会话**的终结状态；用户补充信息后创建新的关联任务，旧任务记录保持终结不变。

任务查询响应固定为同一顶层结构，不随状态改变字段集合，不适用的业务字段返回 `null`：

```python
class AgentResponse(BaseModel):
    schema_version: Literal["2.0"] = "2.0"
    session_id: UUID
    task_id: UUID
    status: AgentTaskStatus
    message: str
    mode: RuntimeModes
    current_version_id: UUID | None
    clarification: ClarificationResult | None
    model: ModelVersion | None
    inspection: InspectionResult | None
    execution: ExecutionStats
    error: ErrorInfo | None
    created_at: datetime
    updated_at: datetime
```

### 5.5 执行统计

```python
class ExecutionStats(BaseModel):
    attempt_count: int = 0
    repair_count: int = 0
    tool_call_count: int = 0
    llm_call_count: int = 0
    llm_retry_count: int = 0
    elapsed_ms: int = 0
    llm_duration_ms: int = 0
    cad_duration_ms: int = 0
    inspection_duration_ms: int = 0
    export_duration_ms: int = 0
```

口径定义（三组实验报告直接引用此口径，避免统计歧义）：

| 字段 | 计数口径 |
| --- | --- |
| `attempt_count` | 已实际开始的几何建模尝试数，含首次与每次修复 |
| `repair_count` | 已发起的计划修订次数；修订计划在校验阶段即失败时仍计入 |
| `tool_call_count` | 所有尝试中实际提交给 `CADBackend` 的工具调用总数 |
| `llm_call_count` | 逻辑 LLM 请求次数，包含被重试的请求 |
| `llm_retry_count` | 因格式错误、限流或网络失败而重发的次数；不计入建模修复次数 |
| `elapsed_ms` | 任务从 `queued` 到终结的总时长，含排队与调度开销 |
| 各阶段耗时 | 仅统计该阶段有效计算时间，之和不必等于 `elapsed_ms` |

### 5.6 模型版本

```python
class ArtifactURLs(BaseModel):
    step: str
    stl: str
    source: str
    log: str
    inspection: str
    plan: str


class RuntimeModes(BaseModel):
    ai: Literal["mock", "real"]
    cad: Literal["mock", "real"]


class ModelVersion(VersionSummary):
    session_id: UUID
    task_id: UUID
    unit: Literal["mm"] = "mm"
    mode: RuntimeModes
    requirements: RequirementState
    inspection: InspectionResult
    execution: ExecutionStats
    files: ArtifactURLs
```

`VersionSummary` 为 `version_id`、`version_number`、`parent_version_id`、`name`、`created_at`。

约定：

- `version_number` 在会话内从 1 连续递增，`(session_id, version_number)` 唯一。
- 版本不可变。验收通过后其需求、计划、检测报告与模型文件不因后续任务被覆盖。
- `parent_version_id` 指向该版本所基于的上一有效版本；首次建模为 `null`。
- `files` 中六个字段均为相对 URL，统一由后端拼装为 `/api/v1/agent/versions/{version_id}/files/{format}`，前端据此校验同源与路径前缀。

### 5.7 检测与测量

```python
class MeasurementResult(BaseModel):
    check_id: str
    name: str
    measurement_type: str
    feature_ref: str | None
    expected: float | bool
    actual: float | bool | None
    absolute_error: float | None
    tolerance: float
    unit: str | None
    required: bool
    status: Literal["passed", "failed", "not_verified"]
    method: str | None
    message: str | None


class InspectionResult(BaseModel):
    valid: bool
    passed: bool
    solid_count: int
    volume_mm3: float | None
    measurements: list[MeasurementResult]
    violations: list[Violation]
    duration_ms: int
```

- `valid` 表示几何实体自身有效，`passed` 表示满足全部必要验收条件，两者语义不同。
- 数量类检查使用整数精确比较，`tolerance = 0`；布尔类检查 `absolute_error = null`。
- 任何必要检查为 `not_verified` 时，整体 `passed` 必须为 `false`。

### 5.8 执行事件

```python
class ExecutionEvent(BaseModel):
    event_id: int
    timestamp: datetime
    stage: AgentTaskStatus
    event_type: str
    level: Literal["debug", "info", "warning", "error"]
    message: str
    attempt_index: int | None
    payload: dict[str, Any]
```

- `event_id` 在每个任务内从 1 连续递增，作为增量查询游标。
- `stage` 必须是任务状态枚举值，前端直接用它渲染阶段标签。
- `event_type` 采用 `<对象>_<动作>` 形式，如 `requirements_parsed`、`plan_created`、`tool_call_completed`、`inspection_failed`、`repair_started`、`version_published`。
- 工具事件独立存于事件流，不作为对话消息返回（规范第 6.5 节）。

### 5.9 本文补充定义的协议

规范中若干结构以表格形式描述，字段清单未落到正文。以下由本文补齐，需在公共基线评审时并入规范：

| 补充项 | 内容 | 依据 |
| --- | --- | --- |
| `SessionStatus` | `idle` / `busy` / `awaiting_input` | 前端 `contracts.ts` 已实现，规范第 6.4 节缺枚举值 |
| `ModelVersion` | 5.6 节完整字段 | 规范第 6.11 节仅写「返回完整 ModelVersion」，第 13 章表格缺字段 |
| `VERSION_CONFLICT` | `base_version_id` 与当前有效版本不一致时返回 409 | 规范第 7.5 节要求传入基线版本，未定义冲突错误码 |
| `INTERRUPTED` | 服务重启时未完成任务的任务级错误码 | 规范未覆盖进程崩溃后的任务收尾 |
| `REPAIR_STALLED` | 相同计划与相同错误重复出现时的终止错误码 | 规范第 12.4 节要求停滞检测，未定义错误码 |

---

## 6. 存储设计

### 6.1 分工

| 内容 | 位置 | 理由 |
| --- | --- | --- |
| 会话、消息、任务、版本、事件索引 | SQLite `outputs/agent.db` | 需要事务、唯一约束与分页查询 |
| 模型文件、源码、计划、检测报告 | 文件系统 `outputs/sessions/<session_id>/` | STEP/STL 体积大，不适合入库 |
| 执行事件明细 | 同时写 SQLite（供接口查询）与 `events.jsonl`（供复现与课程记录） | 接口需要游标分页，实验需要原始日志 |

### 6.2 表结构

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE sessions (
    session_id            TEXT PRIMARY KEY,
    title                 TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('idle', 'busy', 'awaiting_input')),
    current_version_id    TEXT,
    active_task_id        TEXT,
    confirmed_requirements TEXT,
    pending_requirements   TEXT,
    pending_questions      TEXT NOT NULL DEFAULT '[]',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE messages (
    message_id  TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(session_id),
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    task_id     TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at, message_id);

CREATE TABLE tasks (
    task_id           TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES sessions(session_id),
    status            TEXT NOT NULL,
    message           TEXT NOT NULL DEFAULT '',
    user_message      TEXT NOT NULL,
    base_version_id   TEXT,
    clarification     TEXT,
    model_version_id  TEXT,
    inspection        TEXT,
    error             TEXT,
    stats             TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    finished_at       TEXT
);
CREATE INDEX idx_tasks_session ON tasks(session_id, created_at);

-- 同一会话最多一个活跃任务，由数据库层面保证
CREATE UNIQUE INDEX uq_tasks_active ON tasks(session_id)
    WHERE status NOT IN ('completed', 'failed', 'cancelled', 'clarifying');

CREATE TABLE requests (
    client_request_id TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    request_hash      TEXT NOT NULL,
    task_id           TEXT NOT NULL,
    message_id        TEXT NOT NULL,
    created_at        TEXT NOT NULL
);

CREATE TABLE versions (
    version_id        TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES sessions(session_id),
    task_id           TEXT NOT NULL,
    version_number    INTEGER NOT NULL,
    parent_version_id TEXT,
    name              TEXT NOT NULL,
    unit              TEXT NOT NULL,
    mode              TEXT NOT NULL,
    requirements      TEXT NOT NULL,
    inspection        TEXT NOT NULL,
    execution         TEXT NOT NULL,
    directory         TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    UNIQUE (session_id, version_number)
);

CREATE TABLE execution_events (
    task_id       TEXT NOT NULL REFERENCES tasks(task_id),
    event_id      INTEGER NOT NULL,
    timestamp     TEXT NOT NULL,
    stage         TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    level         TEXT NOT NULL,
    message       TEXT NOT NULL,
    attempt_index INTEGER,
    payload       TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (task_id, event_id)
);
CREATE INDEX idx_events_task ON execution_events(task_id, event_id);
```

设计说明：

1. `uq_tasks_active` 使用部分唯一索引，把「单会话单任务」从应用层约定提升为数据库约束，并发提交时由约束冲突转为 `SESSION_BUSY`，不依赖前端节流。
2. `requests.client_request_id` 作为主键，天然实现幂等；`request_hash` 用于区分「同一标识不同内容」。
3. 复杂结构（需求、检测、统计、错误）以 JSON 文本存储，读取时用 Pydantic 反序列化，避免宽表与频繁迁移。
4. 时间统一存 UTC ISO-8601 字符串，输出时保留毫秒精度。

### 6.3 写入并发

- 所有写操作经 `storage/database.py` 的同一个 `threading.Lock` 包裹的短事务执行。
- 读操作使用独立连接，WAL 模式下不阻塞写。
- 事件写入批量提交：单次工具调用结束后一次性写入该步骤产生的全部事件，避免逐条事务。

### 6.4 文件目录布局

```text
outputs/
├── agent.db
└── sessions/
    └── <session_id>/
        ├── requirements.json
        ├── tasks/
        │   └── <task_id>/
        │       ├── events.jsonl
        │       ├── attempt_0/{plan,execution,inspection}.json
        │       └── attempt_1/{plan,execution,inspection}.json
        └── versions/
            ├── v001/{manifest,requirements,plan,inspection}.json
            │        {model.py,model.step,model.stl}
            └── v002/...
```

`outputs/` 与 V0.2.0 的 `MODEL_OUTPUT_DIR` 保持一致，默认 `course_project/outputs`，不纳入 Git。

---

## 7. 任务生命周期与并发控制

### 7.1 提交时序

```text
前端                          后端                          任务线程
 |  POST messages              |                              |
 |--------------------------->|                              |
 |                            | 幂等 → 忙碌 → 版本一致性     |
 |                            | 写 message + task(queued)    |
 |  202 {task_id, message_id} |                              |
 |<---------------------------|  submit(task) -------------->|
 |                            |                              | understanding
 |  GET tasks/{id} (700ms)    |                              | planning
 |--------------------------->| 读 task + stats              | executing
 |  200 AgentResponse         |<-----------------------------| (状态写回 DB)
 |<---------------------------|                              | inspecting
 |  GET tasks/{id}/events     |                              | exporting
 |--------------------------->| 按 event_id 游标增量返回      | completed
 |<---------------------------|                              |
```

前端当前实现为每 700 ms 轮询任务、每次轮询后按 `next_after_event_id` 增量拉取事件，遇 5xx 或网络错误按指数退避重试（上限 5 s）。后端需要保证的两点是：任务状态查询在 100 ms 量级返回（不做重计算），事件游标单调前进。

### 7.2 单会话单任务

三重保障，任一命中即拒绝新请求：

1. 数据库部分唯一索引 `uq_tasks_active`；
2. 服务层在事务内先查 `sessions.active_task_id`，非空则直接返回 409；
3. 进程内 `dict[session_id, threading.Lock]` 用于串行化「检查 + 插入」的竞争窗口。

返回体：

```json
{
  "schema_version": "2.0",
  "error": {
    "code": "SESSION_BUSY",
    "message": "当前会话已有建模任务正在执行",
    "recoverable": true,
    "details": {"active_task_id": "b2222222-2222-4222-8222-222222222222"}
  }
}
```

### 7.3 幂等与去重

判定顺序（严格按此顺序，避免合法网络重试被误判为冲突）：

```text
1. 校验 client_request_id 为 UUID（否则 422 INVALID_REQUEST）
2. 计算 request_hash = sha256(session_id + message + base_version_id)
3. 查 requests 表
   ├─ 命中且 hash 相同 → 返回 202，回执沿用原 task_id / message_id
   ├─ 命中且 hash 不同 → 409 REQUEST_ID_CONFLICT
   └─ 未命中 → 继续
4. 会话忙碌检查 → 409 SESSION_BUSY
5. base_version_id 与 current_version_id 比较 → 409 VERSION_CONFLICT
6. 写入 message、task、requests 三行（同一事务）
```

**回执语义**：去重返回的 `status` 固定为 `"queued"`，含义是「该请求已被受理」，不是任务的实时状态。原因有两点：前端把该响应当作受理凭据，随后立即转入轮询；`TaskAccepted.status` 类型在前端已固定为字面量 `"queued"`。任务的实时状态只能通过 `GET /tasks/{task_id}` 获取。

### 7.4 取消

```text
POST /tasks/{id}/cancel
  ├─ 任务不存在 → 404 TASK_NOT_FOUND
  ├─ 已终结（completed / failed / cancelled / clarifying）→ 409 TASK_ALREADY_FINISHED
  ├─ 已在 cancelling → 202，返回当前状态（幂等）
  └─ 运行中 → 置 cancelling → 202 → 设置取消标记
```

执行器的取消检查点：

1. 每次 LLM 调用前；
2. 每个计划步骤开始前；
3. 每次检测与导出前。

进入 `cancelled` 的条件是执行器在检查点观察到标记并主动返回。由于原生几何计算不可中断，单次 `execute_tool` 会执行到返回为止，随后立即终止流程、释放该次尝试的几何上下文、不发布版本。若任务在 `task_timeout` 内未到达检查点，由超时监管线程直接置 `failed`（`error.code = TASK_TIMEOUT`），并释放资源。

### 7.5 执行预算

```python
class ExecutionBudget:
    max_repairs: int          # 默认 3
    max_tool_calls: int       # 默认 60
    task_timeout_seconds: int # 默认 180
```

- 预算在任务开始时创建，跨尝试累加。
- `max_repairs = 3` 意味着最多 1 次初始执行 + 3 次修复后执行，共 4 次几何建模。
- 达到任一上限：停止建模，任务置 `failed`，`error.code` 分别为 `REPAIR_LIMIT_EXCEEDED`、`TOOL_CALL_LIMIT_EXCEEDED`、`TASK_TIMEOUT`。
- 预算检查在 `orchestrator` 的每次循环入口执行，不依赖 LLM 是否遵守提示词。

### 7.6 崩溃恢复

服务启动时执行一次收尾扫描：

```text
SELECT task_id, session_id FROM tasks
WHERE status NOT IN ('completed', 'failed', 'cancelled', 'clarifying');
```

对每条记录：置 `failed`，`error = {code: "INTERRUPTED", message: "服务重启，任务未完成"} `，对应会话 `active_task_id = NULL`、`status = idle`。已发布版本不受影响，历史遗留的临时目录在启动时清理。

---

## 8. LLM 接入

### 8.1 客户端协议

```python
class LLMClient(Protocol):
    def generate_structured(
        self,
        messages: list[ChatMessage],
        response_schema: type[BaseModel],
        timeout_seconds: float,
    ) -> BaseModel: ...

    def get_model_info(self) -> ModelInfo: ...
```

`ModelInfo` 含 `provider`、`model`、`mode`（`mock` / `real`），供 `/api/v1/agent/config` 输出 `llm_model`（mock 模式下为 `null`）。

### 8.2 适配与配置

```text
agent/
  └── llm_client.py
        ├── OpenAICompatibleClient   # 在线模型：DeepSeek、GLM 等
        └── MockLLMClient            # 固定响应，供前端与离线开发
```

- `OpenAICompatibleClient` 通过 `base_url + /chat/completions` 调用，`response_format = {"type": "json_object"}`，`temperature` 取 0.1–0.2 以保证可复现性。
- 模型名不写死在代码中，由 `LLM_MODEL` 注入；具体选型在选型测试后确定并记入配置表。
- `MockLLMClient` 从 `mock/scenarios/` 读取固定响应，按输入关键词匹配，保证三组实验在无网络环境下可复现完整链路。

### 8.3 结构化输出与重试

```text
请求 → HTTP 200
  ├─ JSON 解析失败        → 格式修复重试 1 次（回填错误信息）→ 仍失败：LLM_OUTPUT_INVALID
  ├─ Pydantic 校验失败    → 同上，回填字段错误
  ├─ 429 / 5xx / 超时     → 指数退避重试，最多 2 次
  └─ 通过                 → 返回模型实例
```

计数规则：

- 格式修复与网络重试统一计入 `llm_retry_count` 与 `llm_call_count`；
- 建模修复（`repair_count`）与 LLM 重试是两个独立概念，前者是业务决策，后者是传输与格式容错。

### 8.4 上下文组织

不把全部历史消息发送给模型。每次调用按以下顺序组装：

```text
[system] 角色与规则（prompts/*.md）
[user]   已确认需求 RequirementState（JSON）
[user]   待确认需求与未答问题（如有）
[user]   当前有效版本摘要（版本号、关键参数、检测结论）
[user]   最近 N 轮相关对话（默认 6 条、按任务边界裁剪）
[user]   本轮用户指令
[user]   （修复场景）失败步骤、错误码、实测值与期望值
```

原始消息全部入库用于追溯，发送内容按当前任务裁剪。裁剪逻辑集中在 `planner.py` 与 `repair.py` 的上下文构造函数中，避免各调用点各自拼接。

### 8.5 提示词组织

| 文件 | 职责 | 输出 |
| --- | --- | --- |
| `requirements.md` | 抽取结构、尺寸、单位、位置关系，判定缺失与冲突 | `RequirementPatch` 或 `ClarificationResult` |
| `planning.md` | 依据需求与工具清单生成建模计划 | `ModelingPlan` |
| `repair.md` | 依据失败反馈修订计划 | `RepairResult` |
| `revision.md` | 解析多轮修改指令，生成参数变更集 | `RequirementPatch` |

规划提示词必须包含：本地锁定版本支持的工具定义、坐标系与单位约定、禁止调用未注册工具、禁止修改用户已确认参数、JSON Schema。这些是硬约束，同时在 `plan_validator.py` 中做程序化复核，不依赖模型自觉。

### 8.6 密钥与日志

- API Key 只从进程环境变量读取，不写入仓库、不写入响应、不写入事件日志。
- 日志中出现的请求头统一脱敏为 `Authorization: ***`。
- `/api/v1/agent/config` 仅返回运行模式、模型名与功能开关，不返回地址、密钥或内部路径。

---

## 9. 需求理解与澄清

### 9.1 流水线

```text
用户消息
   ↓ requirements.md
RequirementPatch（仅包含本轮涉及的字段）
   ↓ 与 confirmed_requirements / pending_requirements 合并
候选 RequirementState
   ↓ constraints.py 确定性校验
   ├─ 必要参数缺失 → 生成 Question → clarifying
   ├─ 参数冲突无法自动消解 → 生成 Question → clarifying
   └─ 全部就绪 → 写入 confirmed_requirements → planning
```

### 9.2 合并语义

- 采用增量合并，不以新需求覆盖旧需求。未被提及的参数保持原值与原 `source`。
- 用户本轮修改的参数：`source = "user"`、`confirmed = true`、记录 `old_value` 供事件日志与前端对比使用。
- 派生参数（如由外径与壁厚推算的分布圆）标记 `source = "derived"`，并记录推导依据到 `constraints`。
- 单位归一化在合并前完成：`m` / `cm` / `inch` 统一换算为 `mm`，无法识别的单位视为缺失并追问。

### 9.3 确定性约束

可由数学关系判定的约束一律由程序检查，不交给模型。以圆形法兰盘为例（外径 `D`、内径 `d`、孔径 `h`、分布圆直径 `P`、孔数 `n`）：

```text
安装孔不超出外圆：      (P + h) / 2 < D / 2
安装孔不与中心孔相交：  (P - h) / 2 > d / 2
相邻安装孔不相交：      P * sin(pi / n) > h
```

违反任一条即生成 `conflicts`，转入澄清；不得由修复模块自行缩小孔径或减少孔数来「凑通过」。这与规范第 12.4 节修复边界一致。

### 9.4 澄清任务的落库

任务以 `clarifying` 终结时执行：

1. `tasks.clarification` 写入 `ClarificationResult`；
2. `sessions.pending_requirements` 写入候选需求，`pending_questions` 写入问题列表；
3. `sessions.status = awaiting_input`，`active_task_id = NULL`；
4. `confirmed_requirements` **不更新**，已发布版本不受影响。

用户回复后走新任务，`base_version_id` 沿用 `current_version_id`，上下文中带上 `pending_requirements` 与已答问题，避免重复追问。

### 9.5 澄清消息

澄清结果同时以 `assistant` 消息写入对话（`task_id` 指向该澄清任务），供历史回看；问题卡片则以 `clarification.questions` 结构化返回，前端两者都用。

---

## 10. 规划与计划校验

### 10.1 计划生成

输入为需求状态与 `CADBackend.list_tools()` 返回的工具定义。输出为 `ModelingPlan`，包含 `parameters`、`steps`、`final_output_id`。

工具清单由 CAD 适配层提供，本层不做硬编码。规划提示词中的工具列表与执行期的注册表同源，避免出现「提示词里有、执行器里没有」的工具名。

### 10.2 校验清单

`plan_validator.py` 在执行前逐项检查，任一项失败即产出具名错误：

| # | 检查项 | 失败错误码 |
| --- | --- | --- |
| 1 | 结构符合 `ModelingPlan` Schema | `PLAN_SCHEMA_INVALID` |
| 2 | 步骤数 ≤ `max_steps`（默认 40） | `PLAN_TOO_LARGE` |
| 3 | `step_id` 唯一且非空 | `PLAN_DUPLICATE_STEP` |
| 4 | `output_id` 唯一且非空 | `PLAN_DUPLICATE_OUTPUT` |
| 5 | `tool_name` 在注册表中存在 | `PLAN_UNKNOWN_TOOL` |
| 6 | 参数符合该工具的 `input_schema` | `PLAN_ARGUMENT_INVALID` |
| 7 | `depends_on` 引用的 `step_id` 全部存在 | `PLAN_MISSING_DEPENDENCY` |
| 8 | 依赖图无环（拓扑排序可完成） | `PLAN_CYCLE` |
| 9 | 工具参数中引用的 `target_id` / `tool_ids` 在依赖闭包内已产出 | `PLAN_UNRESOLVED_REFERENCE` |
| 10 | 参数引用 `{"param": ...}` 可在 `parameters` 中解析 | `PLAN_UNKNOWN_PARAMETER` |
| 11 | 表达式树深度与运算次数不超过上限（8 / 16），无除零、无非有限数 | `PLAN_EXPRESSION_INVALID` |
| 12 | `final_output_id` 存在且为实体类输出 | `PLAN_FINAL_OUTPUT_MISSING` |
| 13 | 逻辑产物与已确认需求的特征映射完整 | `PLAN_FEATURE_MISSING` |

第 13 项用于保证「需求里要求的特征在计划里有着落」，否则会出现模型生成成功但缺孔、缺缺口的情况。

### 10.3 失败处理

```text
校验失败
  ├─ 错误属于「模型能力/需求不可满足」（如尺寸冲突）→ repair 决策为 ask_user
  ├─ 错误属于「计划书写问题」（工具名、参数、依赖）→ repair 决策为 revise_plan
  └─ 修复次数超限 → failed(REPAIR_LIMIT_EXCEEDED)
```

计划校验失败不进入 `executing`，因此不消耗 `attempt_count`，但仍消耗 `repair_count`。这与规范第 12.3 节「计划执行前校验失败可能增加修复次数但不增加实际执行尝试次数」一致。

---

## 11. 执行调度

### 11.1 `execute_plan`

```python
def execute_plan(plan, backend, budget, attempt_index, events) -> ExecutionResult:
    order = topological_order(plan.steps)          # 同层按原计划顺序
    ctx = backend.begin_attempt(task_id, attempt_index)
    try:
        for step in order:
            budget.check()                          # 工具调用上限 / 取消 / 超时
            args = resolve_parameters(step.arguments, plan.parameters)
            validate_tool_arguments(step.tool_name, args)   # 二次校验
            result = backend.execute_tool(ToolCall(...))
            events.emit(...)
            if not result.success:
                return ExecutionResult.failure(step, result.error)   # fail-fast
        return ExecutionResult.success(plan.final_output_id)
    finally:
        backend.release_attempt(task_id, attempt_index)
```

要点：

1. **拓扑排序 + 稳定次序**：同层步骤按计划原顺序执行，保证同一计划多次执行的结果一致，便于复现实验。
2. **参数解析在计划层完成**：`ToolCall` 中只允许出现已解析的数值，CAD 适配层不实现表达式求值（规范第 9.5 节）。
3. **参数二次校验**：即便规划阶段已校验，执行前再校验一次，防止修复过程生成的计划绕过校验入口。
4. **fail-fast**：某步骤失败后不再执行依赖它的步骤，直接返回失败与 `failed_step_id`。
5. **上下文隔离**：每次尝试独立 `begin_attempt` / `release_attempt`，失败尝试的几何对象不污染下一次尝试，也不影响已发布版本。

### 11.2 与 CAD 适配层的调用边界

- 所有调用在线程内同步执行，外层加几何锁串行；
- 单次 `execute_tool` 不设独立超时（原生调用不可中断），依靠任务总时限兜底；
- `CADBackend` 的实现可以在子进程中，本层通过代理对象调用，不感知进程边界（规范第 10.6 节）。

### 11.3 执行结果归一

```python
class ExecutionResult(BaseModel):
    success: bool
    model_ref: str | None
    attempt_index: int
    tool_results: list[ToolResult]
    failed_step_id: str | None
    duration_ms: int
    error: ErrorInfo | None
```

执行成功但 `model_ref` 为空、或 `tool_results` 中的产物数量与计划不符，均视为执行失败（`EXECUTION_INCONSISTENT`），防止「程序没报错」被当成建模成功。

---

## 12. 检测与验收

### 12.1 目标值来源（关键原则）

检测项的期望值一律取自 `sessions.confirmed_requirements`，**不得**取自待验收的 `ModelingPlan.parameters`。否则计划中的错误参数会被当作正确标准，形成「自己判自己」。

反例（禁止）：

```python
actual_diameter = plan.parameters["hole_diameter"]   # 用输入参数冒充实测值
```

### 12.2 检测项生成

`inspector` 由需求层生成检测请求：

```text
RequirementState.parameters（required = true）
        ↓ 参数 → 检测类型映射表
MeasurementCheck(check_id, measurement_type, feature_ref, expected, tolerance, arguments)
        ↓
CADBackend.inspect(...)
```

初始容差（本组实验标准，非工业精度承诺）：

| 测量类型 | 容差 | 单位 |
| --- | --- | --- |
| 长度类（长度、厚度、外径、孔径、分布圆） | ±0.01 | mm |
| 角度类 | ±0.1 | degree |
| 数量、布尔类 | 0（精确比较） | — |

### 12.3 测量实现路径

具体实现由 CAD 适配层完成，本层只约定请求与返回。当前 SDK 可用的几何事实来自 `inspect_shape_rbrepinspection`，其返回结构包含 `valid`、`counts`、`bounding_box`、`volume`、`faces`、`edges`，其中 `faces[].surface` 对圆柱面给出 `type`、`radius`、`axis`、`location`。据此可支撑下列测量：

| 测量类型 | 数据来源 | 匹配规则 |
| --- | --- | --- |
| `hole_diameter` | 圆柱面 `radius × 2` | 轴向与 `expected_axis` 平行、轴线过 `search_center` |
| `outer_diameter` | 最大圆柱面 `radius × 2` | 轴线与期望轴向一致 |
| `hole_count` | 满足匹配条件的圆柱面计数 | 同一轴向与分布圆半径 |
| `thickness` / `height` / `length` | `bounding_box` 差值，或平行平面间距 | 按测量类型选择 |
| `angle` | 两平面 `normal` 或两圆柱 `axis` | `arccos` 前对点积做 `[-1, 1]` 截断 |
| `concentric` | 两圆柱 `axis` 平行且轴线距离 ≤ 容差 | 布尔结果 |
| `solid_count` | `counts["solid"]` | 与期望整数精确比较 |

无法可靠识别目标特征时返回 `not_verified` 并写明原因，不得降级为 `passed`。

### 12.4 聚合判定

```text
passed = valid
       ∧ (solid_count == expected_solid_count)
       ∧ (每个 required 检测项均存在且 status == "passed")
       ∧ (不存在影响任务成功的 required 约束违反)
```

- 缺失检测项按未通过处理；
- 可选检测项未通过只记 `warning` 级事件，不改变 `passed`；
- `not_verified` 计入「未通过」，同时单独统计，供实验报告区分「测不准」与「确实不符」。

### 12.5 检测失败后的分流

| 情况 | 处理 |
| --- | --- |
| 实体无效 / 实体数量不符 | 可修复，走 `repairing` |
| 尺寸超差，且期望值来自用户确认 | 可修复，走 `repairing` |
| 约束冲突（需求本身不可满足） | 不可修复，转 `ask_user` 澄清 |
| 连续两次相同计划与相同错误 | 停滞，终止 `REPAIR_STALLED` |

---

## 13. 自动修复

### 13.1 输入

```python
class RepairRequest(BaseModel):
    task_id: UUID
    plan_id: UUID
    current_revision: int
    attempt_index: int
    repair_count: int
    remaining_repairs: int
    failure_stage: AgentTaskStatus
    failed_step_id: str | None
    failure: ErrorInfo
    requirements: RequirementState      # 完整需求，不裁剪
    previous_plan: ModelingPlan         # 上一份计划
    inspection: InspectionResult | None # 实测结果
```

只提供错误字符串不足以修复，必须同时给出完整需求、上一份计划与实测值。

### 13.2 输出

```python
class RepairResult(BaseModel):
    action: Literal["revise_plan", "ask_user", "abort"]
    repair_reason: str
    revised_plan: ModelingPlan | None
    clarification: ClarificationResult | None
```

- `revise_plan` 必须提供完整新计划（第一阶段不做局部补丁，降低实现复杂度与校验难度）；
- `ask_user` 必须提供澄清问题，任务以 `clarifying` 终结；
- `abort` 必须给出可读原因，任务以 `failed` 终结。

### 13.3 修复边界

修复模块不得：

1. 修改用户已确认的参数（`source=user` 且 `confirmed=true`）；
2. 降低检测容差或改写检测结果；
3. 删除需求中要求的特征以绕过检测；
4. 复用失败尝试的几何对象。

若修订计划违反上述任一条，`plan_validator` 或 `requirements.py` 直接拒绝并记录 `warning` 事件。

### 13.4 停滞检测

```text
plan_hash      = sha256(规范化 JSON 的 steps)
error_signature = (error.code, failed_step_id, violation.feature_ref)
```

同一个 `(plan_hash, error_signature)` 连续出现两次，判定为停滞，终止并返回 `REPAIR_STALLED`，附 `details: {repair_count, last_error_code}`。这避免模型在相同错误上反复消耗预算。

---

## 14. 版本发布与产物管理

### 14.1 发布流程

```text
1. 在 tasks/<task_id>/attempt_N/ 下完成建模、导出、检测
2. 源文件生成：source_builder → model.py（参数化，关键尺寸为变量）
3. 文件完整性检查：model.step / model.stl / model.py 存在且非空
4. 检测结论 passed = true
5. 分配 version_number（会话内 seq + 1，事务内完成）
6. 目录原子迁移：attempt_N → versions/vNNN/（同卷 rename）
7. 写入 versions 行、更新 sessions.current_version_id、清空 active_task_id
8. 写 version_published 事件
```

第 5–7 步在同一事务内完成。文件系统与 SQLite 不是天然的两阶段事务，因此先 rename 再提交事务；若事务失败，保留目录并记 `VERSION_PUBLISH_FAILED`，启动扫描时清理无对应记录的版本目录（`manifest.json` 中记录 `published_at`，未发布目录不参与对外查询）。

### 14.2 不可变与恢复

- 版本目录发布后不再写入。
- 恢复历史版本不作为原地回退，而是以该版本需求为基线创建新任务，生成新版本，`parent_version_id` 指向被恢复的版本。
- 失败任务的中间产物只保留在 `tasks/` 下，不进入 `versions/`，也不出现在版本列表接口中。

### 14.3 下载安全

- 下载接口只接受 `version_id` 与 `format`，不接受路径参数；
- `format` 白名单映射固定文件名，映射表在 `artifact_service.py` 中常量定义：

| format | 文件 | Content-Type |
| --- | --- | --- |
| `step` | `model.step` | `application/step` |
| `stl` | `model.stl` | `model/stl` |
| `source` | `model.py` | `text/x-python; charset=utf-8` |
| `log` | `events.jsonl` | `application/x-ndjson` |
| `inspection` | `inspection.json` | `application/json` |
| `plan` | `plan.json` | `application/json` |

- 解析出的绝对路径必须 `resolve()` 后确认仍位于该版本目录内，防止路径穿越；
- 文件缺失返回 404 `FILE_NOT_FOUND`，不返回 500。

---

## 15. HTTP 接口实现

### 15.1 路由总表

| # | 方法 | 路径 | 成功码 | 响应模型 |
| --- | --- | --- | --- | --- |
| 1 | POST | `/api/v1/agent/sessions` | 201 | `SessionSummary` + `schema_version` |
| 2 | GET | `/api/v1/agent/sessions` | 200 | 分页 `SessionSummary` 列表 |
| 3 | GET | `/api/v1/agent/sessions/{session_id}` | 200 | `Session` + `schema_version` |
| 4 | GET | `/api/v1/agent/sessions/{session_id}/messages` | 200 | 分页 `ChatMessage` 列表 |
| 5 | POST | `/api/v1/agent/sessions/{session_id}/messages` | 202 | 受理回执 |
| 6 | GET | `/api/v1/agent/tasks/{task_id}` | 200 | `AgentResponse` |
| 7 | GET | `/api/v1/agent/tasks/{task_id}/events` | 200 | 事件增量页 |
| 8 | POST | `/api/v1/agent/tasks/{task_id}/cancel` | 202 / 200 | 取消回执 |
| 9 | GET | `/api/v1/agent/sessions/{session_id}/versions` | 200 | 分页 `VersionSummary` 列表 |
| 10 | GET | `/api/v1/agent/versions/{version_id}` | 200 | `ModelVersion` |
| 11 | GET | `/api/v1/agent/versions/{version_id}/files/{format}` | 200 | 二进制文件 |
| 12 | GET | `/api/v1/agent/tools` | 200 | 工具清单 |
| 13 | GET | `/api/v1/agent/config` | 200 | 公开配置 |

分页参数统一为 `limit`（1–100，默认 20）与 `offset`（≥ 0，默认 0）。所有列表响应必须回显 `schema_version`、`items`、`total`、`limit`、`offset` 五个字段。

### 15.2 各接口实现要点

**1. 创建会话**

- 标题去首尾空白后长度 1–80，空串返回 422 `INVALID_REQUEST`。
- 新会话 `status = idle`、`current_version_id = null`、`active_task_id = null`、`pending_questions = []`。
- 返回体包含 `schema_version`，与其余接口保持一致。

**2. 会话列表**

- 排序 `updated_at DESC, session_id DESC`，第二个键用于稳定分页。
- `total` 为满足条件的总行数，与当前页无关。

**3. 会话详情**

- `confirmed_requirements` 与 `pending_requirements` 可能为 `null`，`pending_questions` 必须为数组，不可为 `null`（前端按数组使用）。

**4. 消息列表**

- 排序 `created_at ASC, message_id ASC`。
- 仅返回 `user` 与 `assistant` 两类；工具事件不出现在此接口。

**5. 提交需求**

- 请求体 `{schema_version, client_request_id, message, base_version_id}`；`message` 去空白后 1–4000 字符。
- `client_request_id` 必须是 UUID 字符串。
- `base_version_id` 与 `current_version_id` 严格相等（同为 `null` 或同为同一 UUID），否则 409 `VERSION_CONFLICT`。
- 提交的同时写入 `user` 消息，返回 `message_id`，前端据此去重渲染。

**6. 任务状态**

- 顶层固定字段：`schema_version`、`session_id`、`task_id`、`status`、`message`、`mode`、`current_version_id`、`clarification`、`model`、`inspection`、`execution`、`error`、`created_at`、`updated_at`。
- `model` 只在 `status = completed` 且 `model_version_id` 非空时填充；任务失败时保持 `null`，不得把旧模型塞入。
- `current_version_id` 始终表示查询时会话的当前有效版本，与本次任务是否成功无关。
- `message` 是面向用户的一行阶段说明（如「正在测量关键尺寸」），不编造百分比进度。

**7. 任务事件**

- `after_event_id`（≥ 0，默认 0）、`limit`（1–200，默认 100）。
- `next_after_event_id` 等于本页最后一条 `event_id`；本页为空时等于入参 `after_event_id`。
- `has_more = true` 时，`next_after_event_id` **必须**严格大于入参游标，否则前端判定分页不一致并抛错。
- 实现方式：按 `event_id > cursor ORDER BY event_id LIMIT limit + 1` 取一页，多取的一条仅用于判定 `has_more`。

**8. 取消任务**

- 已终结任务返回 409 `TASK_ALREADY_FINISHED`；`cancelled` 状态的任务重复取消返回 200 与 `cancelled`。
- 请求体为空，不要求 `Content-Type`。

**9. 版本列表**

- 排序 `version_number DESC`；顶层额外返回 `current_version_id`。
- 仅返回 `VersionSummary` 五个字段，完整模型走接口 10。

**10. 版本详情**

- 直接返回 `ModelVersion`，不额外包一层。
- `files` 中六个 URL 全部以 `/api/v1/agent/versions/` 开头，否则前端会丢弃链接（`artifactHref` 校验前缀）。

**11. 文件下载**

- 返回真实文件内容，不做 Base64 包装。
- 支持 `Range` 请求头会带来复杂度，本版不实现，STL 体积在单零件量级可整体传输。

**12. 工具清单**

- 直接由 `CADBackend.list_tools()` 生成，`input_schema` 与 `output_schema` 为完整 JSON Schema，不使用空对象占位。
- 工具清单按当前 `CAD_MODE` 缓存，模式切换需重启服务。

**13. 公开配置**

- 返回 `mode`、`llm_model`、`limits`、`features`。`features` 三项与前端强相关：`task_cancellation`、`version_comparison`、`source_download`。
- 前端在 `features.task_cancellation` 为 `false` 时隐藏取消按钮，因此该开关必须与实际能力一致。

### 15.3 错误响应

统一形状（与 V0.2.0 的 `ErrorResponse` 保持同一风格，新增 `recoverable` 与 `details`）：

```json
{
  "schema_version": "2.0",
  "error": {
    "code": "SESSION_BUSY",
    "message": "当前会话已有建模任务正在执行",
    "recoverable": true,
    "details": {}
  }
}
```

两类错误必须区分：

| 类别 | HTTP | 载体 | 示例 |
| --- | --- | --- | --- |
| 请求层错误 | 4xx / 5xx | 上述错误体 | `SESSION_BUSY`、`VERSION_CONFLICT`、`FILE_NOT_FOUND` |
| 任务层错误 | 200 | `AgentResponse.error`，`status = failed` | `REPAIR_LIMIT_EXCEEDED`、`DIMENSION_MISMATCH` |

任务查询本身成功、而内部建模失败时返回 200，因为查询请求是成功的。

### 15.4 与前端契约的逐字段核对

核对对象为 `editor-web/src/agent/contracts.ts` 与 `api.ts`（提交 `39d216d`）。结论：本文模型与前端类型**逐字段一致**，可用于冻结。

| 前端类型 | 本文对应 | 核对结果 |
| --- | --- | --- |
| `TaskStatus`（12 个值） | `AgentTaskStatus` | 一致 |
| `isTerminal`（clarifying/completed/failed/cancelled） | 5.4 终结状态集合 | 一致 |
| `AgentConfig` | 15.2 接口 13 | 一致；`features` 三项键名相同 |
| `AgentRequest` | 15.2 接口 5 请求体 | 一致 |
| `TaskAccepted` | 受理回执 | 一致；`status` 固定 `"queued"` |
| `Question` | `Question` | 一致；`expected_type` 四值与 `unit` 可空一致 |
| `RequirementState` | 5.3 | 一致；`source` 四值、`conflicts[].fields/message` 一致 |
| `Measurement` | `MeasurementResult` | 一致；`expected` 允许 number/boolean，`unit` 可空 |
| `Inspection` | `InspectionResult` | 一致；`volume_mm3` 可空，`violations[].check_id` 可空 |
| `ExecutionStats` | 5.5 | 一致，10 个字段同名 |
| `ArtifactURLs` | 5.6 | 一致，6 个键同名 |
| `VersionSummary` | 5.6 基类 | 一致 |
| `ModelVersion` | 5.6 | 一致；`requirements`、`inspection`、`execution`、`files`、`mode`、`unit`、`task_id` 均必备 |
| `AgentTask` | `AgentResponse` | 一致；`clarification` 可空对象、`model` 可空 |
| `SessionSummary` | 5.2 | 一致；`status` 三值与前端一致 |
| `Session` | 5.2 | 一致；`pending_questions` 为数组 |
| `ChatMessage` | 5.2 / 接口 4 | 一致；`task_id` 可空 |
| `ExecutionEvent` | 5.8 | 一致；`stage` 复用 `TaskStatus`，`level` 四值一致 |

前端行为对后端的三条隐含要求（已在 15.2 落实）：

1. `list()` 会校验响应中的 `offset` 是否等于请求的 `offset`，因此分页必须回显入参；
2. 轮询间隔 700 ms，任务状态查询必须为纯读操作；
3. 任务终结后前端立即重载会话，后端必须在终结事务中同步清空 `active_task_id`，否则前端会一直判定 `busy`。

---

## 16. 配置、安全与合规

### 16.1 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_MODE` | `mock` | `mock` / `real`，沿用 V0.2.0 |
| `CAD_MODE` | `mock` | `mock` / `real`，沿用 V0.2.0 |
| `MODEL_OUTPUT_DIR` | `course_project/outputs` | 产物根目录 |
| `LLM_PROVIDER` | 空 | 供应商标识，仅用于日志 |
| `LLM_BASE_URL` | 空 | 兼容 OpenAI 协议的地址 |
| `LLM_API_KEY` | 空 | 仅从环境读取 |
| `LLM_MODEL` | 空 | 模型名 |
| `LLM_TIMEOUT_SECONDS` | `30` | 单次调用超时 |
| `AGENT_MAX_REPAIRS` | `3` | 最大修复次数 |
| `AGENT_MAX_TOOL_CALLS` | `60` | 最大工具调用数 |
| `AGENT_TASK_TIMEOUT_SECONDS` | `180` | 任务总时限 |
| `AGENT_DB_PATH` | `outputs/agent.db` | 数据库路径 |

### 16.2 启动校验

- `AI_MODE=real` 而 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 缺失时，启动阶段直接失败并打印缺失项，不静默回退 mock（沿用 V0.2.0「配置非法即启动失败」的策略）。
- `CAD_MODE=real` 而 CAD 适配层不可用时，启动失败并给出明确的导入错误。
- 预算类数值必须为正整数，越界即启动失败。

### 16.3 配置读取方式

V0.2.0 明确不自动读取 `.env`。本模块沿用该策略：所有配置来自进程环境变量，`.env.example` 仅作为文档提供，实际注入由启动脚本完成。这样既避免密钥文件被误提交，也避免与既有 `start.ps1` 的行为不一致。

### 16.4 输入限制

| 项 | 限制 | 超限处理 |
| --- | --- | --- |
| 单条消息 | 1–4000 字符 | 422 `INVALID_REQUEST` |
| 会话标题 | 1–80 字符 | 422 `INVALID_REQUEST` |
| 分页 `limit` | 1–100 | 422 `INVALID_REQUEST` |
| 计划步骤数 | ≤ 40 | `PLAN_TOO_LARGE` |
| 表达式深度 / 运算数 | 8 / 16 | `PLAN_EXPRESSION_INVALID` |
| 会话数 | 不限制 | — |

路径与命令执行方面的约束：本模块不接受任何客户端提供的文件路径；不执行模型生成的任意 Python 代码；工具调用只能命中注册表内的白名单工具。

---

## 17. 测试计划

### 17.1 分层

| 层 | 范围 | 依赖 | 判据 |
| --- | --- | --- | --- |
| 单元 | 需求合并、约束公式、计划校验 13 项、错误签名、分页游标 | 无 | 全部通过，覆盖率覆盖分支 |
| 契约 | Pydantic ↔ JSON Schema ↔ `contracts.ts` 字段一致性 | 无 | 无缺失、无多余、类型兼容 |
| 服务 | 会话、任务、版本服务的数据库行为 | SQLite 临时库 | 事务、唯一约束、幂等生效 |
| 集成 | Mock LLM + Mock CAD 的完整链路 | 无网络、无内核 | 三组案例均能走到 `completed` |
| 端到端 | 真实 LLM + 真实 CAD | 需要 API Key 与内核 | 三组实验真实运行并留存日志 |

### 17.2 关键用例

| 编号 | 用例 | 期望 |
| --- | --- | --- |
| T-01 | 相同 `client_request_id` 重复提交相同内容 | 202，返回同一 `task_id`、`message_id`，不新建任务 |
| T-02 | 相同 `client_request_id` 提交不同内容 | 409 `REQUEST_ID_CONFLICT` |
| T-03 | 会话有活跃任务时提交新请求 | 409 `SESSION_BUSY` |
| T-04 | `base_version_id` 与当前版本不一致 | 409 `VERSION_CONFLICT` |
| T-05 | 缺少关键参数 | 任务 `clarifying`，问题列表非空，`confirmed_requirements` 不变 |
| T-06 | 追答澄清问题 | 新任务成功，且不再重复追问已答参数 |
| T-07 | 法兰孔布局违反 `P·sin(π/n) > h` | 转澄清，不自动改孔径 |
| T-08 | 计划引用不存在的工具 | `PLAN_UNKNOWN_TOOL`，进入 `repairing`，`attempt_count` 不增 |
| T-09 | 检测孔径 10 mm 而需求 8 mm | 检测 `failed`，反馈修复，最终孔径 8 mm 通过 |
| T-10 | 修复次数达到上限仍失败 | `failed` + `REPAIR_LIMIT_EXCEEDED`，`repair_count = 3` |
| T-11 | 相同错误连续两次 | `REPAIR_STALLED`，不继续消耗预算 |
| T-12 | 工具调用数超过 60 | `TOOL_CALL_LIMIT_EXCEEDED` |
| T-13 | 运行中取消 | `cancelling` → `cancelled`，不发布版本，历史版本保留 |
| T-14 | 已完成任务取消 | 409 `TASK_ALREADY_FINISHED` |
| T-15 | 取消后立即重新提交 | 新任务可执行，会话不再 `busy` |
| T-16 | 失败任务不覆盖历史版本 | `current_version_id` 仍指向旧版本，`model` 为 `null` |
| T-17 | 多轮修改仅改外径，其余参数保留 | 新版本中内径、厚度、孔径与旧版本一致 |
| T-18 | 事件增量查询 | 游标单调前进，`has_more` 判定正确，无重复无遗漏 |
| T-19 | 下载不存在的格式 | 404 `FILE_NOT_FOUND` |
| T-20 | 下载路径穿越（构造 `../`） | 被拒绝，返回 404 |
| T-21 | 服务重启时存在运行中任务 | 启动后任务置 `INTERRUPTED`，会话回到 `idle` |
| T-22 | `AI_MODE=real` 缺少密钥 | 启动失败，错误信息列出缺失项 |
| T-23 | 检测无法识别目标面 | `not_verified`，整体 `passed = false` |
| T-24 | 三组案例完整运行 | 全部 `completed`，产物齐全，统计字段可核对 |

### 17.3 模式矩阵

| AI_MODE | CAD_MODE | 用途 | 前提 |
| --- | --- | --- | --- |
| mock | mock | 前端与后端独立开发、接口联调 | 无网络、无内核 |
| real | mock | 需求理解与规划的模型效果评估 | 需要 API Key |
| mock | real | 工具、检测、修复的几何正确性 | 需要完整安装 |
| real | real | 三组实验与演示视频 | 全量环境 |

Mock 结果必须在响应与事件中带 `mode` 标记，模拟测量值不计入真实建模实验统计。

---

## 18. 开发计划

按依赖顺序推进，阶段之间不复用未验证的部分。

| 阶段 | 内容 | 完成判据 |
| --- | --- | --- |
| M1 契约与骨架 | `agent_contracts.py`、数据库、四个只读接口、Mock 全链路 | 前端在 Mock 模式下可完成建会话、提交、看状态、看事件的完整操作 |
| M2 需求与规划 | LLM 适配、需求合并、约束检查、澄清、计划生成与校验 | 三组案例的澄清与计划在 `real` AI + `mock` CAD 下可复现 |
| M3 执行与检测 | 执行调度、检测调用、结果聚合、事件记录 | `mock` AI + `real` CAD 下产出真实几何与检测报告 |
| M4 修复与版本 | 修复决策、停滞检测、版本发布、下载、取消、超时 | T-09 至 T-16 全部通过 |
| M5 实验与交付 | 三组案例真实运行、统计口径核对、报告数据 | T-24 通过，统计表与产物一致 |

跨阶段不变的前提：接口形状在 M1 结束时冻结；此后新增字段必须同时更新 `agent_contracts.py`、`schemas/`、`API.md` 与 `contracts.ts`。

---

## 19. 待确认事项

以下五项需要在公共基线评审时确认，未确认前按「建议」列执行。

| 编号 | 事项 | 建议 | 影响 |
| --- | --- | --- | --- |
| D1 | Web 框架：沿用 Starlette 还是改用 FastAPI | 沿用 Starlette（见 3.3） | 改框架需重写异常处理以保持错误体形状 |
| D2 | 去重回执的状态码与 `status` 取值 | 202 + 固定 `"queued"`（见 7.3） | 与前端 `TaskAccepted` 类型绑定 |
| D3 | 长方体原点语义：最小角点还是底面中心 | 工具契约统一为最小角点，由 CAD 适配层换算 | 见下方说明 |
| D4 | `tool_cancellation` 是否作为 P0 功能 | 作为 P0 | 影响 7.4 的实现与 T-13 |
| D5 | 前端类型是否改为由 JSON Schema 生成 | 保持手写，增加字段核对脚本 | 手写需在每次协议变更后同步 |

**D3 补充说明（坐标系口径）**

V0.2.0 的 `API.md` 记录「长方体底面中心在原点」，而《公共接口与数据协议规范》第 3.3 节约定 `origin` 为最小角点、底面中心位于 `(L/2, W/2, 0)`。两者不一致，且上游 SDK 的 `make_box_rsolid(width, height, depth, bottom_face_center=(0,0,0))` 明确采用**底面中心**语义，文档给出「要占据 `x∈[0,w]`，应传 `bottom_face_center=(w/2, h/2, z0)`」。

因此需要明确：工具契约采用规范的最小角点语义，由 CAD 适配层完成 `origin` → `bottom_face_center` 的换算。本模块只按契约语义生成计划与期望坐标，不感知内核的原点习惯。同理，`make_cylinder_rsolid` 接收半径而工具契约使用直径，适配层需做 `/2` 换算；`make_box_rsolid` 的三维参数顺序为 `(x, y, z)`，与「长度、宽度、高度」一一对应，但形参名为 `width/height/depth`，按位置传参时容易踩错，适配层应使用关键字参数。

上述三条换算属于 CAD 适配层职责，需在该层实现并写入其设计说明；本模块的检测期望值按契约语义计算。

---

## 附录 A 错误码

**请求层（HTTP 4xx / 5xx）**

| 错误码 | HTTP | 场景 | 可恢复 |
| --- | --- | --- | --- |
| `INVALID_REQUEST` | 422 | 请求体、长度、分页参数非法 | 是 |
| `SCHEMA_VERSION_UNSUPPORTED` | 422 | `schema_version` 不是 `2.0` | 否 |
| `SESSION_NOT_FOUND` | 404 | 会话不存在 | 否 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 | 否 |
| `VERSION_NOT_FOUND` | 404 | 版本不存在 | 否 |
| `FILE_NOT_FOUND` | 404 | 文件或格式不存在 | 否 |
| `REQUEST_ID_CONFLICT` | 409 | 同一请求标识对应不同内容 | 否 |
| `SESSION_BUSY` | 409 | 会话已有活跃任务 | 是 |
| `VERSION_CONFLICT` | 409 | 基线版本与当前版本不一致 | 是 |
| `TASK_ALREADY_FINISHED` | 409 | 对已终结任务执行取消 | 否 |
| `LLM_UNAVAILABLE` | 502 | 模型服务不可用或鉴权失败 | 是 |
| `INTERNAL_ERROR` | 500 | 未处理异常 | 是 |

**任务层（HTTP 200，`status = failed` 的 `error.code`）**

| 错误码 | 场景 |
| --- | --- |
| `PLAN_SCHEMA_INVALID` / `PLAN_UNKNOWN_TOOL` / `PLAN_CYCLE` / `PLAN_UNRESOLVED_REFERENCE` / `PLAN_FINAL_OUTPUT_MISSING` / `PLAN_FEATURE_MISSING` | 计划校验失败 |
| `PLAN_TOO_LARGE` / `PLAN_DUPLICATE_STEP` / `PLAN_DUPLICATE_OUTPUT` / `PLAN_ARGUMENT_INVALID` / `PLAN_MISSING_DEPENDENCY` / `PLAN_UNKNOWN_PARAMETER` / `PLAN_EXPRESSION_INVALID` | 计划结构或参数非法 |
| `CAD_TOOL_FAILED` / `BOOLEAN_FAILED` / `EXECUTION_INCONSISTENT` | 几何执行失败或产物不一致 |
| `DIMENSION_MISMATCH` / `CONSTRAINT_VIOLATED` / `INVALID_SOLID` | 几何检测不通过 |
| `REPAIR_LIMIT_EXCEEDED` / `REPAIR_STALLED` | 修复次数或停滞终止 |
| `TOOL_CALL_LIMIT_EXCEEDED` / `TASK_TIMEOUT` | 资源上限终止 |
| `TASK_CANCELLED` | 用户取消 |
| `INTERRUPTED` | 服务重启中断 |
| `LLM_OUTPUT_INVALID` | 模型输出无法解析为合法结构 |
| `VERSION_PUBLISH_FAILED` | 产物发布失败 |

## 附录 B 与规范的章节对照

| 规范章节 | 本文对应 |
| --- | --- |
| 2.1–2.3 基本约定与标识符 | 5.1、15.3 |
| 3 坐标系与几何语义 | 19（D3）、12.3 |
| 4 公共数据模型 | 5 全章 |
| 5 任务状态协议 | 5.4、7 |
| 6 前后端 HTTP API | 15 |
| 7 需求与约束协议 | 5.3、9 |
| 8 工具注册与计划协议 | 10、11 |
| 9 ModelingPlan | 10.1、11.1 |
| 10 ToolCall / ToolResult | 11.1、11.3 |
| 11 检测与测量 | 12 |
| 12 自动修复 | 13 |
| 13 模型产物与版本 | 14 |
| 14–15 服务与存储 | 6、15 |
| 16 前端设计 | 15.4（仅契约侧） |
| 17 Mock / Real | 17.3 |
| 18 安全 | 16 |
