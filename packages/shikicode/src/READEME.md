# QuickXBuild ShikiCode

A modern code editor component built on top of **Shiki**, providing high-performance syntax highlighting and code editing capabilities for web applications.

```typescript

import { createHighlighter } from 'shiki'

import { shikiCode } from '@quickxbuild/shikicode'

const highlighter = await createHighlighter({

langs: ['javascript'],

themes: ['github-dark']

})

const editor = shikiCode()

.create(containerElement, highlighter, {

value: 'console.log("Hello, ShikiCode!")',

language: 'javascript',

theme: 'github-dark'

})

```

## Core Features

- 🎨 **200+ Programming Language Support** - VS Code-level syntax highlighting

- 🔧 **Rich Editing Features** - Smart indentation, bracket matching, code commenting

- 🧩 **Plugin System** - Extensible modular architecture

- ⚡ **High Performance** - Virtual scrolling, on-demand loading, memory optimization

## Documentation

- 📖 **Complete Development Documentation**: [DEV-ZH.md](./DEV-ZH.md) | [DEV.md](./DEV.md)

- 🎮 **Online Demo**: Open [index.html](./index.html) to see the actual effect

## Credits

Developed based on the [magic-akari/shikicode](https://github.com/magic-akari/shikicode/) project