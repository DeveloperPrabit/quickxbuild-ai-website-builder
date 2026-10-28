# QuickXBuild ShikiCode 包

QuickXBuild ShikiCode 是一个基于 **Shiki** 构建的现代化代码编辑器组件，为 Web 应用提供高性能的语法高亮和代码编辑功能。该包采用工厂模式设计，通过丰富的插件系统实现自动缩进、括号自动闭合、注释切换等专业代码编辑器功能。它支持 Shiki 所有编程语言和主题，提供与 VS Code 一致的语法高亮效果，同时保持轻量级和高度可定制的特性。

## 🚀 核心特性

### ✨ 语法高亮
- **完整语言支持**：支持 Shiki 所有内置编程语言的精确语法高亮
- **VS Code 级别的高亮效果**：基于 TextMate 语法和 Shiki 引擎
- **主题系统**：支持所有 Shiki 内置主题，动态主题切换
- **动态加载**：语言和主题按需加载，优化性能

### 🔧 编辑功能
- **智能缩进**：基于 Tab 和空格的智能缩进管理，支持自动检测
- **括号自动闭合**：支持多种语言的括号、引号等成对符号自动闭合
- **行号显示**：可配置的行号显示功能，带视觉样式
- **代码注释**：支持单行和多行注释切换，语言特定的注释规则

### 🧩 插件系统
- **函数式插件架构**：基于生命周期的插件管理机制
- **内置核心插件**：autoload、closing_pairs、comments、tab
- **自定义插件**：支持开发自定义功能插件，提供完整的 API
- **插件组合**：支持多插件组合和配置

### ⚡ 性能优化
- **双层渲染架构**：透明 textarea 输入层 + div 显示层的高效架构
- **事件同步**：输入和滚动事件的精确同步机制
- **内存管理**：提供完整的销毁和清理机制
- **CSS 变量**：基于 CSS 自定义属性的样式系统

## 📁 项目结构

```bash
packages/shikicode/
├── lib/                       # 构建产物
│   ├── index.js              # 主要导出构建文件
│   ├── index.d.ts            # TypeScript 类型定义
│   └── plugins/              # 插件系统构建产物
├── src/                       # 源代码目录
│   ├── index.ts              # 包导出入口，重新导出 core.ts
│   ├── core.ts               # 核心编辑器实现，工厂函数和接口
│   ├── scroll.ts             # 滚动同步功能，输入输出层同步
│   ├── style.ts              # CSS 样式注入和管理
│   └── plugins/              # 插件系统
│       ├── index.ts          # 插件类型定义和导出
│       ├── autoload.ts       # 自动加载语言和主题
│       ├── closing_pairs.ts  # 括号、引号自动闭合
│       ├── comments.ts       # 行注释和块注释切换
│       ├── tab.ts            # Tab 缩进、Enter 智能换行
│       └── common.ts         # 插件工具函数
├── index.html                # 演示页面和测试环境
├── package.json              # 包依赖与脚本定义
├── tsconfig.json             # TypeScript 配置
└── tsup.config.ts            # 构建配置
```

## 🛠️ 技术实现

### 核心技术栈
- **Shiki v3.7.0**：TextMate 语法的 JavaScript 实现，提供 VS Code 级别的语法高亮
- **TypeScript**：类型安全的开发体验，严格模式
- **原生 DOM API**：无框架依赖，直接使用浏览器 API
- **CSS Variables**：`--fg`、`--bg`、`--tab-size` 等自定义属性

### 架构设计
- **双层渲染**：透明的 `textarea` 用于输入，`div` 用于语法高亮显示
- **事件同步**：`input` 事件触发重新渲染，`scroll` 事件同步滚动位置
- **工厂模式**：`shikiCode()` 工厂函数提供链式配置API
- **插件系统**：函数式插件，返回清理函数，支持动态添加和移除
- **样式隔离**：通过哈希值避免样式冲突，动态注入CSS规则

## 🚀 安装与使用

### 包依赖

在 QuickXBuild 项目中，shikicode 作为内部包使用：

```json
{
  "name": "@quickxbuild/shikicode",
  "version": "0.0.0",
  "devDependencies": {
    "shiki": "^3.7.0"
  }
}
```

### 基础用法

```typescript
import { createHighlighter } from 'shiki'
import { shikiCode } from '@quickxbuild/shikicode'

// 创建高亮器实例
const highlighter = await createHighlighter({
  langs: ['javascript', 'typescript'],
  themes: ['github-dark', 'github-light']
})

// 创建编辑器实例
const editor = shikiCode()
  .withOptions({
    lineNumbers: 'on',     // 显示行号
    readOnly: false,       // 可编辑
    tabSize: 4,           // Tab 大小为 4 个空格
    insertSpaces: true    // 使用空格而非 Tab 字符
  })
  .create(containerElement, highlighter, {
    value: 'console.log("Hello, ShikiCode!")',
    language: 'javascript',
    theme: 'github-dark'
  })

// 获取和设置内容
console.log(editor.value) // 获取当前代码
editor.value = 'const message = "New code"' // 设置新代码并重新渲染
```

### 高级配置

```typescript
import { shikiCode } from '@quickxbuild/shikicode'
import { 
  autoload, 
  hookClosingPairs, 
  hookTab, 
  comments 
} from '@quickxbuild/shikicode/plugins'

const editor = shikiCode()
  .withOptions({
    lineNumbers: 'on',
    readOnly: false,
    tabSize: 4,
    insertSpaces: true
  })
  .withPlugins(
    // 自动加载缺失的语言和主题
    autoload,
    // 自动闭合括号（无参数使用默认规则）
    hookClosingPairs(),
    // Tab 缩进支持，Enter 智能换行
    hookTab,
    // 注释切换（Ctrl/Cmd + /）
    comments({ 
      language: 'typescript', 
      lineComment: '//', 
      blockComment: ['/*', '*/'],
      insertSpace: true
    })
  )
  .create(container, highlighter, {
    value: initialCode,
    language: 'typescript',
    theme: 'github-dark'
  })

// 动态更新选项
editor.updateOptions({
  theme: 'github-light',
  language: 'python'
})

// 动态添加插件
editor.addPlugin(autoload)

// 清理编辑器
editor.dispose()
```

## 🧩 插件系统

### 内置插件

#### 1. AutoLoad 插件 (`autoload`)
自动加载缺失的语言和主题，将 `updateOptions` 转换为异步方法：

```typescript
import { autoload } from '@quickxbuild/shikicode/plugins'

editor.addPlugin(autoload)

// 现在 updateOptions 是异步的
await editor.updateOptions({
  language: 'rust',  // 自动加载 rust 语言
  theme: 'monokai'   // 自动加载 monokai 主题
})
```

#### 2. 括号自动闭合插件 (`hookClosingPairs`)
支持多种语言的括号、引号自动闭合：

```typescript
import { hookClosingPairs } from '@quickxbuild/shikicode/plugins'

// 使用默认配置（支持所有内置语言规则）
editor.addPlugin(hookClosingPairs())

// 自定义语言规则
editor.addPlugin(hookClosingPairs({
  language: 'javascript',
  pairs: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
    ['`', '`']
  ]
}))
```

**功能特性：**
- 输入左括号时自动插入右括号
- 选中文本时用括号包围
- Backspace 时删除成对括号
- 输入右括号时跳过已存在的右括号

#### 3. 注释切换插件 (`comments`)
支持行注释和块注释的切换（Ctrl/Cmd + /）：

```typescript
import { comments } from '@quickxbuild/shikicode/plugins'

editor.addPlugin(comments({
  language: 'typescript',
  lineComment: '//',
  blockComment: ['/*', '*/'],
  insertSpace: true // 注释符号后插入空格
}))
```

**功能特性：**
- 单行：自动注释/反注释当前行
- 多行：批量注释/反注释选中行
- 智能空格处理

#### 4. Tab 缩进插件 (`hookTab`)
智能 Tab 缩进和 Enter 换行：

```typescript
import { hookTab } from '@quickxbuild/shikicode/plugins'

editor.addPlugin(hookTab)
```

**功能特性：**
- **Tab**：智能缩进，多行选择时批量缩进
- **Shift+Tab**：减少缩进
- **Enter**：智能换行，自动继承当前行缩进
- **Backspace**：在空白符上智能删除到上一个 Tab 位置
- **Escape**：失焦编辑器
- 支持括号内换行时自动增加缩进

### 自定义插件开发

插件是接收编辑器实例和选项，返回清理函数的函数：

```typescript
import type { EditorPlugin, ShikiCode, EditorOptions } from '@quickxbuild/shikicode/plugins'

const myCustomPlugin: EditorPlugin = (editor: ShikiCode, options: EditorOptions) => {
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'F1') {
      // 自定义快捷键逻辑
      console.log('F1 pressed, current language:', options.language)
      console.log('Current value:', editor.value)
    }
  }

  // 绑定事件到输入元素
  editor.input.addEventListener('keydown', handleKeydown)

  // 必须返回清理函数
  return () => {
    editor.input.removeEventListener('keydown', handleKeydown)
  }
}

// 使用自定义插件
editor.addPlugin(myCustomPlugin)
```

**插件开发要点：**
- 接收 `ShikiCode` 实例和 `EditorOptions` 配置
- 可以访问 `editor.input`（textarea）、`editor.output`（div）、`editor.highlighter`
- 必须返回清理函数以避免内存泄漏
- 可以监听键盘事件、输入事件等
- 支持访问和修改编辑器内容

## 🎨 主题和样式

### 主题切换

```typescript
// 动态切换主题（确保主题已加载）
editor.updateOptions({
  theme: 'github-light'
})

// 同时切换语言和主题
editor.updateOptions({
  language: 'python',
  theme: 'monokai'
})

// 使用 autoload 插件时自动加载
await editor.updateOptions({
  theme: 'material-theme-darker'  // 自动加载新主题
})
```

### CSS 变量系统

编辑器使用 CSS 自定义属性进行样式管理：

```css
/* 容器级别的变量 */
.editor-container {
  --fg: #24292f;        /* 前景色（文字颜色） */
  --bg: #ffffff;        /* 背景色 */
  --tab-size: 4;        /* Tab 大小 */
  --font-family: 'JetBrains Mono', monospace;
}

/* 自定义输入层样式 */
.shikicode.input {
  font-family: var(--font-family, monospace);
  font-size: 14px;
  line-height: 1.5;
  caret-color: var(--fg, black);
}

/* 自定义行号样式 */
.shikicode.output.line-numbers .line::before {
  color: #6b7280;
  background-color: var(--bg);
  width: 5em;
  padding-right: 2em;
}

/* 调整行号区域大小 */
.shikicode.input.line-numbers {
  padding-left: 5em;
}
```

## 📚 API 参考

### ShikiCode 接口

```typescript
interface ShikiCode {
  // DOM 元素
  readonly input: HTMLTextAreaElement      // 透明输入层
  readonly output: HTMLDivElement          // 语法高亮显示层
  readonly container: HTMLElement          // 容器元素
  
  // 高亮器实例
  readonly highlighter: Highlighter       // Shiki 高亮器
  
  // 内容管理
  value: string                           // 获取/设置编辑器内容
  forceRender(value?: string): void       // 强制重新渲染
  
  // 配置更新
  updateOptions(options: UpdateOptions): void
  
  // 插件管理
  addPlugin(plugin: EditorPlugin): void   // 动态添加插件
  
  // 销毁编辑器
  dispose(): void                         // 清理资源和事件监听器
}
```

### 工厂函数接口

```typescript
interface ShikiCodeFactory {
  create(domElement: HTMLElement, highlighter: Highlighter, options: InitOptions): ShikiCode
  withOptions(options: UpdateOptions): ShikiCodeFactory
  withPlugins(...plugins: readonly EditorPlugin[]): ShikiCodeFactory
}

// 工厂函数
function shikiCode(): ShikiCodeFactory
```

### 配置选项

```typescript
interface EditorOptions extends IndentOptions {
  // 行号显示
  lineNumbers: 'on' | 'off'
  
  // 只读模式
  readOnly: boolean
  
  // 语言设置（支持 Shiki 所有语言 + 扩展）
  language: BundledLanguage | 'plaintext' | 'txt' | 'text' | 'plain' | (string & {})
  
  // 主题设置（支持 Shiki 所有主题 + 'none'）
  theme: BundledTheme | 'none' | (string & {})
}

interface IndentOptions {
  // Tab 大小（默认 4）
  tabSize: number
  
  // 使用空格而非 Tab 字符（默认 true）
  insertSpaces: boolean
}

// 初始化选项
interface InitOptions extends Pick<EditorOptions, 'language' | 'theme'> {
  readonly value?: string
}

// 更新选项（所有属性可选）
interface UpdateOptions extends Partial<EditorOptions> {}
```

## 🔧 开发指南

### 本地开发

在 QuickXBuild 项目根目录运行：

```bash
# 安装依赖
bun install

# 构建 shikicode 包
bun run build

# 运行类型检查
bun run typecheck

# 清理构建产物
bun run clean
```

### 包构建

使用 tsup 进行构建：

```bash
# packages/shikicode 目录下
bun run build
```

构建配置 (`tsup.config.ts`)：
- 输出格式：ESM
- 目标：`lib/` 目录
- 类型定义：自动生成 `.d.ts` 文件
- 插件系统：独立打包为 `plugins/` 子目录

### 测试编辑器

打开演示页面：

```bash
# 在 packages/shikicode 目录下启动静态服务器
python -m http.server 8000
# 或使用 bun
bun --bun vite

# 访问 http://localhost:8000/index.html
```

### 扩展编辑器

#### 添加新语言支持

```typescript
// 手动加载新语言
await editor.highlighter.loadLanguage('rust')
editor.updateOptions({ language: 'rust' })

// 使用 autoload 插件自动加载
editor.addPlugin(autoload)
await editor.updateOptions({ language: 'rust' })  // 自动加载
```

#### 添加新的括号闭合规则

```typescript
import { hookClosingPairs } from '@quickxbuild/shikicode/plugins'

// 为自定义语言添加括号规则
editor.addPlugin(hookClosingPairs({
  language: 'my-language',
  pairs: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['<', '>'],  // XML/HTML 标签
    ['"', '"'],
    ["'", "'"]
  ]
}))
```

#### 创建自定义主题

```typescript
// 加载自定义主题对象
await editor.highlighter.loadTheme({
  name: 'my-custom-theme',
  type: 'dark',
  colors: {
    'editor.background': '#1a1a1a',
    'editor.foreground': '#d4d4d4'
  },
  tokenColors: [
    {
      scope: ['comment'],
      settings: { foreground: '#6A9955' }
    }
  ]
})

editor.updateOptions({ theme: 'my-custom-theme' })
```

## 🎯 解决的问题

### 1. 高质量语法高亮
- **精确的语法解析**：基于 TextMate 语法规则，与 VS Code 完全一致
- **完整语言支持**：支持 Shiki 所有内置语言，无需额外配置
- **主题一致性**：与 VS Code 主题完全兼容，提供一致的视觉体验

### 2. Web 平台代码编辑
- **双层架构**：透明输入层 + 高亮显示层，解决浏览器编辑器技术难题
- **事件同步**：精确的输入、滚动事件同步机制
- **无框架依赖**：纯 DOM API 实现，可集成到任何前端技术栈

### 3. 可扩展性和定制化
- **插件系统**：函数式插件架构，支持自定义编辑行为
- **类型安全**：完整的 TypeScript 类型定义和接口
- **CSS 变量**：基于 CSS 自定义属性的样式系统

### 4. 性能优化
- **按需加载**：语言和主题动态加载，减少初始包体积
- **内存管理**：完整的销毁机制，避免内存泄漏
- **样式隔离**：哈希化样式，避免全局样式冲突

## 📖 相关资源

- **Shiki 官方文档**: [https://shiki.style/](https://shiki.style/)
- **TextMate 语法规范**: [https://macromates.com/manual/en/language_grammars](https://macromates.com/manual/en/language_grammars)
- **VS Code 主题开发**: [https://code.visualstudio.com/api/extension-guides/color-theme](https://code.visualstudio.com/api/extension-guides/color-theme)
- **原始灵感项目**: [magic-akari/shikicode](https://github.com/magic-akari/shikicode)

## 🛠️ 内部实现细节

### 核心文件说明

| 文件 | 功能 | 主要导出 |
|------|------|----------|
| `core.ts` | 核心编辑器实现 | `shikiCode`, `ShikiCode`, `EditorOptions` |
| `scroll.ts` | 滚动同步 | `hookScroll` |
| `style.ts` | 样式注入 | `injectStyle` |
| `plugins/index.ts` | 插件类型定义 | `EditorPlugin`, `IDisposable` |
| `plugins/autoload.ts` | 自动加载 | `autoload` |
| `plugins/closing_pairs.ts` | 括号闭合 | `hookClosingPairs`, 默认语言规则 |
| `plugins/comments.ts` | 注释切换 | `comments` |
| `plugins/tab.ts` | 缩进管理 | `hookTab`, `indentText`, `outdentText` |
| `plugins/common.ts` | 工具函数 | `setRangeText`, `visibleWidthFromLeft` |

### 构建和导出

```json
{
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./plugins": {
      "types": "./lib/plugins/index.d.ts",
      "default": "./lib/plugins/index.js"
    }
  }
}
```
 