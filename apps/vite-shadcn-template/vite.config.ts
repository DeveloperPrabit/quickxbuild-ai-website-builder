import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { componentTagger } from "sandbox-tagger";
import { defineConfig, type Plugin } from 'vite'

function localHttpsConfig(): true | { key: Buffer; cert: Buffer } | undefined {
  if (process.env.LOCAL_PREVIEW_HTTPS !== '1') {
    return undefined
  }

  const certDir = path.resolve(__dirname, '../web/certificates')
  const keyPath = path.join(certDir, 'localhost-key.pem')
  const certPath = path.join(certDir, 'localhost.pem')
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    }
  }

  return true
}

function frameAncestorCsp(): string {
  const extras: string[] = []
  for (const raw of [
    process.env.PREVIEW_FRAME_ANCESTORS,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.PUBLIC_PREVIEW_URL,
  ]) {
    if (!raw?.trim()) continue
    for (const part of raw.trim().split(/\s+/)) {
      try {
        const origin = new URL(part).origin
        if (origin && !extras.includes(origin)) {
          extras.push(origin)
        }
      } catch {
        // ignore invalid
      }
    }
  }

  const parts = [
    "frame-ancestors 'self'",
    'http://localhost:*',
    'https://localhost:*',
    'http://127.0.0.1:*',
    'https://127.0.0.1:*',
    ...extras,
  ]
  // Builder UIs (QuickXBuild etc.) embed this preview over HTTPS. Without an
  // explicit platform origin, allow any https parent so the IDE iframe works.
  if (!extras.some((origin) => origin.startsWith('https:'))) {
    parts.push('https:')
  }
  return parts.join(' ')
}

function inspectorOverlayGuard(): Plugin {
  return {
    name: 'inspector-overlay-guard',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: `(function () {
  var noise = function (args) {
    return args.some(function (arg) {
      return String(arg || '').indexOf('[snapdom]') !== -1;
    });
  };
  ['warn', 'error', 'info', 'debug'].forEach(function (method) {
    var original = console[method].bind(console);
    console[method] = function () {
      if (noise(Array.prototype.slice.call(arguments))) return;
      return original.apply(console, arguments);
    };
  });

  var dismiss = function () {
    var nodes = document.querySelectorAll('body *');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!(el instanceof HTMLElement)) continue;
      var text = el.textContent || '';
      var z = parseInt(window.getComputedStyle(el).zIndex, 10);
      if (z < 9000) continue;
      if (text.indexOf('Console Error Monitor') !== -1 || text.indexOf('[snapdom]') !== -1) {
        el.remove();
      }
    }
  };

  var start = function () {
    dismiss();
    var reportRoutes = function () {
      try {
        var routes = Array.prototype.map.call(document.querySelectorAll('a[href]'), function (link) {
          return new URL(link.getAttribute('href'), window.location.href).pathname;
        }).filter(function (route, index, all) {
          return route.startsWith('/') && all.indexOf(route) === index;
        });
        routes.push(window.location.pathname);
        window.parent.postMessage({ type: 'PREVIEW_ROUTES', payload: { routes: routes } }, '*');
      } catch (ignore) {}
    };
    reportRoutes();
    var observer = new MutationObserver(dismiss);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    new MutationObserver(reportRoutes).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', reportRoutes);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  window.addEventListener('error', function (event) {
    try {
      var blank = !document.body || document.body.children.length === 0;
      window.parent.postMessage({
        type: 'RUNTIME_ERROR',
        error: {
          message: event.message || 'Runtime error',
          filename: event.filename || '',
          lineno: event.lineno || 0,
          colno: event.colno || 0,
          stack: event.error && event.error.stack ? event.error.stack : '',
          blankScreen: blank
        }
      }, '*');
    } catch (ignore) {}
  });
  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event.reason;
      var message = typeof reason === 'string' ? reason : (reason && reason.message) || 'Unhandled promise rejection';
      window.parent.postMessage({
        type: 'UNHANDLED_PROMISE_REJECTION',
        error: {
          message: String(message),
          stack: reason && reason.stack ? reason.stack : '',
          blankScreen: false
        }
      }, '*');
    } catch (ignore) {}
  });
})();`,
        },
      ]
    },
  }
}

// https://vitejs.dev/config/
// @ts-ignore
export default defineConfig(({ mode }) => {

  // Set the default value of INSPECTOR_URL according to environment settings.
  const getDefaultInspectorUrl = () => {
    // If the environment variable VITE_INSPECTOR_URL is already set, use it directly.
    // if (env.VITE_INSPECTOR_URL) {
    //   return env.VITE_INSPECTOR_URL;
    // }

    // If not set, determine the default based on the mode
    // if (mode === 'development') {
    //   return `http://${env.VITE_INSPECTOR_HOST || 'localhost'}:${env.VITE_INSPECTOR_PORT || '3004'}`;
    // }

    // Default to cdn.quickxbuild.dev for production and other environments
    return 'https://cdn.quickxbuild.dev';
  };

  const https = localHttpsConfig()
  const viteBase = (process.env.VITE_BASE || '/').trim() || '/'
  const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
    ? Number(process.env.VITE_HMR_CLIENT_PORT)
    : undefined

  return {
    base: viteBase.endsWith('/') ? viteBase : `${viteBase}/`,
    server: {
      host: "::",
      port: 5173,
      allowedHosts: true,
      ...(https ? { https } : {}),
      ...(hmrClientPort
        ? {
            hmr: {
              clientPort: hmrClientPort,
              path: viteBase === '/' ? undefined : viteBase.replace(/\/$/, ''),
            },
          }
        : {}),
      cors: {
        origin: true,
        credentials: true,
      },
      headers: {
        'Content-Security-Policy': frameAncestorCsp(),
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    plugins: [
      inspectorOverlayGuard(),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Define environment variables
    define: {
      'import.meta.env.VITE_INSPECTOR_URL': JSON.stringify(getDefaultInspectorUrl())
    }
  };
});
