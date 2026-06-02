# GitNexus HarmonyOS 增强版

这是基于官方 GitNexus fork 后的本地增强版本，主要目标是让 GitNexus 更适合分析 HarmonyOS / ArkTS / ETS 项目，并把关系数据导出到 Obsidian 中查看。

当前重点不是保留官方 GitNexus 的通用介绍，而是记录本分支新增和调整过的能力。

## 当前项目路径

GitNexus fork 路径：

```text
C:\project\GitNexus
```

GitNexus CLI/Core 代码路径：

```text
C:\project\GitNexus\gitnexus
```

当前已索引的 HarmonyOS 项目示例：

```text
C:\project\liberlive-harmonyOS
```

索引名称：

```text
liberlive-harmonyOS
```

## 新增能力

### HarmonyOS / ArkTS / ETS 识别

本 fork 增强了对 HarmonyOS 项目的识别能力：

- 将 `.ets` / `.ats` 按 TypeScript / ArkTS 风格解析
- 识别 HarmonyOS 页面和路由
- 识别 `@Component`
- 识别 `@ComponentV2`
- 识别 `@CustomDialog`
- 排除 `@Entry` 组件，避免页面入口和普通组件重复建模
- 建立组件与组件之间的嵌套 / 使用关系
- 建立组件与 Class 之间的引用关系
- 建立路由与页面组件之间的关系

### AppStorage 关系

本 fork 增加了 HarmonyOS `AppStorage` 相关识别：

- 识别 `AppStorage` key
- 识别页面 / 组件 / 类中对 `AppStorage` 的读取
- 识别页面 / 组件 / 类中对 `AppStorage` 的写入
- 识别状态绑定关系

这些关系会进入 GitNexus 图谱，也可以通过 MCP 或 Obsidian 导出查看。

### Web 图谱优化

针对大图谱做过一些本地优化：

- 默认过滤器只显示 `Class`
- 修复顺序布局 / 径向布局切换时因为节点名称缺失导致的黑屏
- 对无名称节点增加显示名回退逻辑
- 降低大图谱首次进入时的视觉和性能压力

### MCP 与 Web 服务并行

当前版本调整过本地读取逻辑，目标是减少 MCP 和 Web 页面同时访问索引时的数据库锁冲突：

- 页面打开时，MCP 优先复用本地 HTTP 服务能力
- 页面未打开时，MCP 仍可直接读取本地索引
- 减少访问 `http://localhost:4747/api/health` 后 MCP 异常的概率

## Obsidian Markdown 导出

这是本 fork 新增的重点功能。

可以将 GitNexus 图谱导出成 Obsidian 可识别的 Markdown 文件，并通过 `[[双链]]` 形成 Obsidian 关系图谱。

默认导出的节点类型：

```text
Component
Class
Route
StorageKey
```

默认导出的关系类型：

```text
USES_COMPONENT
ROUTE_COMPONENT
USES_CLASS
READS_STORAGE
WRITES_STORAGE
BINDS_STORAGE
EXTENDS
IMPLEMENTS
```

### 默认导出命令

在 `C:\project\GitNexus` 下执行：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS
```

如果不传 `--out`，默认会生成到：

```text
C:\project\GitNexus\obsidian-exports\liberlive-harmonyOS
```

默认目录规则是：

```text
当前执行命令的目录\obsidian-exports\项目名
```

例如仍然在 `C:\project\GitNexus` 下执行：

```powershell
gitnexus export obsidian --repo another-project
```

会生成到：

```text
C:\project\GitNexus\obsidian-exports\another-project
```

### 指定导出目录

也可以手动指定 Obsidian 仓库目录：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS --out "D:\ObsidianVault\GitNexus-liberlive"
```

### 导出结果结构

导出后会生成类似结构：

```text
GitNexus Export.md
Class\
Component\
Route\
StorageKey\
```

其中 `GitNexus Export.md` 是入口索引文件。

每个节点会生成一个 Markdown 文件，例如：

```text
Component\AccountPage.md
Class\AccountViewModel.md
StorageKey\currentDevice.md
```

文件之间使用 Obsidian 双链，例如：

```md
[[Class/AccountViewModel|AccountViewModel]]
[[Component/DevicePageSkeleton|DevicePageSkeleton]]
[[StorageKey/currentDevice|currentDevice]]
```

因此可以直接在 Obsidian 的关系图谱中查看组件、类、路由、存储 key 之间的依赖关系。

### 只导出部分类型

只导出组件和类：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS --types Component,Class
```

只导出组件使用类的关系：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS --types Component,Class --relations USES_CLASS
```

测试少量节点：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS --limit 50
```

## 常用命令

### 安装本地 fork 版本

```powershell
cd C:\project\GitNexus\gitnexus
npm install
npm run build
npm install -g C:\project\GitNexus\gitnexus
```

### 建立或更新索引

进入目标项目根目录：

```powershell
cd C:\project\liberlive-harmonyOS
npx gitnexus analyze
```

### 启动 Web 页面

```powershell
gitnexus serve --port 4747
```

浏览器打开：

```text
http://localhost:4747/?project=liberlive-harmonyOS&server=http%3A%2F%2Flocalhost%3A4747
```

### 检查服务健康

```text
http://localhost:4747/api/health
```

### 导出 Obsidian Markdown

```powershell
cd C:\project\GitNexus
gitnexus export obsidian --repo liberlive-harmonyOS
```

## 使用建议

### 给 AI / MCP 使用

日常让 Codex 或其他 AI 获取依赖关系时，优先使用 GitNexus MCP。

适合查询：

- 某个组件依赖哪些组件
- 某个组件被哪些组件依赖
- 某个组件引用了哪些类
- 某个类被哪些组件引用
- 某个 AppStorage key 被哪些页面或组件使用
- 修改某个类会影响哪些页面或组件

### 给人工浏览使用

当 Web 图谱节点过大导致卡顿时，推荐使用 Obsidian 导出：

```powershell
gitnexus export obsidian --repo liberlive-harmonyOS
```

然后把下面目录作为 Obsidian 仓库打开：

```text
C:\project\GitNexus\obsidian-exports\liberlive-harmonyOS
```

Obsidian 更适合浏览大量 Markdown 双链关系，性能通常比 Web 大图谱更稳定。

## 当前验证结果

在 `liberlive-harmonyOS` 上验证过：

```text
1518 个 Markdown 笔记
1970 条 Obsidian 双链关系
```

已验证命令：

```powershell
npx vitest run test/unit/obsidian-export.test.ts
npx tsc --noEmit
npm run build
gitnexus export obsidian --repo liberlive-harmonyOS
```

## 注意事项

- `obsidian-exports` 是导出结果目录，可以删除后重新生成。
- 如果索引过旧，先在目标项目中执行 `npx gitnexus analyze`。
- 如果 Web 页面未启动，MCP 和 CLI 仍然可以尝试直接读取本地索引。
- 如果 Web 页面已启动，MCP 会尽量复用本地服务，减少数据库锁冲突。
- 当前导出是 Markdown 双链，不是 Obsidian Canvas。

## 后续可继续增强

可以继续扩展的方向：

- 增加 Obsidian Canvas 导出
- 增加 Mermaid 局部依赖图导出
- 增加按页面导出的组件树
- 增加按 AppStorage key 聚合的状态流向文档
- 增加按路由聚合的页面跳转文档
- 增加一键导出后自动打开 Obsidian 的命令
