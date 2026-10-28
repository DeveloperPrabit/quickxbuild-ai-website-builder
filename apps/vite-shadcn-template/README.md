# Vite Shadcn Template

A modern React template driven by Vite, featuring Shadcn UI components, Tailwind CSS, and a component inspector for effortless development.

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)

![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

## Features

- ⚡️ **Vite** - Lightning-fast frontend tooling

- 🧩 **Shadcn UI** - High-quality UI components built with Radix UI and Tailwind CSS

- 🔍 **Component Inspector** - Visual debugging and inspection of components

- 🎨 **Tailwind CSS** - Utility-first CSS framework

- 📦 **TypeScript** - Type safety for components

- 🔄 **React Query** - Powerful data fetching and state management

- 📱 **Responsive Design** - All components built with a mobile-first approach

- 🧪 **Firecracker Sandbox** - Preconfigured development sandbox environment

## Tech Stack

- **React**: UI quickxbuildry
- **Vite**: Build tool
- **TypeScript**: Type checking
- **Tailwind CSS**: Styling
- **Shadcn UI**: Component quickxbuildry
- **React Router**: Routing
- **React Query**: Data fetching
- **React Hook Form**: Form handling

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Bun (recommended) or npm/yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/vite-shadcn-template.git
cd vite-shadcn-template

# Install dependencies
bun install
# or using npm
npm install
```

### Development

```bash
# Start development server
bun run dev
# or using npm
npm run dev
```

The app will be available at `http://localhost:5173`.

### Production Build

```bash
# Build the project
bun run build
# or using npm
npm run build

# Preview production build
bun run preview
# or using npm
npm run preview
```

## Project Structure

```
vite-shadcn-template/
├── public/ # Static assets
├── src/
│ ├── assets/ # Images, fonts, etc.
│ ├── components/
│ │ └── ui/ # Shadcn UI components
│ ├── hooks/ # Custom React hooks
│ ├── lib/ # Utility functions
│ ├── pages/ # Page components
│ ├── App.tsx # Main app component
│ ├── index.css # Global styles
│ └── main.tsx # App entry point
├── .dockerignore # Docker ignore file
├── .gitignore # Git ignore file
├── components.json # Shadcn UI configuration
├── index.html # HTML entry point
├── package.json # Project dependencies
├── tsconfig.json # TypeScript configuration
└── vite.config.ts # Vite configuration
```

## Component Inspector

This template includes a component inspector to help you debug and inspect React components in real-time.

The inspector is automatically enabled in development mode and can be accessed through the browser. It allows you to:

- Inspect component hierarchy
- View component props and state
- Debug component rendering

You can configure the inspector using the following environment variables:

- `VITE_INSPECTOR_URL` - Custom URL for the inspector

## Environment Variables

Create a `.env` file in the root directory to customize configurations:

```
# Inspector configuration
VITE_INSPECTOR_HOST=localhost
VITE_INSPECTOR_PORT=3004
VITE_INSPECTOR_URL=https://cdn.quickxbuild.dev
```

## Contributing

Contributions are welcome! Feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Built with ❤️ by [QuickXBuild](https://quickxbuild.dev)