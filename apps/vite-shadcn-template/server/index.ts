import { createServer } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { Server as SocketIOServer } from 'socket.io'
import { forgotPassword, login, logout, me, resetPassword, signup } from './auth'
import { githubCallback, googleCallback, oauthStatus, startGithub, startGoogle } from './auth-oauth'
import { APP_SCHEMA } from './db'
import { migrateAppSchema } from './migrate'
import { setRealtimeServer } from './realtime'
import { adminRouter } from './routes/admin'
import { filesRouter } from './routes/files'
import { itemsRouter } from './routes/items'
import { mailRouter } from './routes/mail'
import { ordersRouter } from './routes/orders'
import { paymentsRouter } from './routes/payments'
import { productsRouter } from './routes/products'
import { webhooksRouter } from './routes/webhooks'

const PORT = Number(process.env.APP_API_PORT || 8787)

const app = new Hono()

app.use(
  '*',
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://localhost:3000',
      'http://localhost:3005',
      'http://127.0.0.1:3005',
    ],
    credentials: true,
  })
)

app.get('/api/health', (c) => c.json({ ok: true, schema: APP_SCHEMA }))
app.post('/api/auth/signup', signup)
app.post('/api/auth/login', login)
app.post('/api/auth/logout', logout)
app.post('/api/auth/forgot', forgotPassword)
app.post('/api/auth/reset', resetPassword)
app.get('/api/auth/oauth', oauthStatus)
app.get('/api/auth/google', startGoogle)
app.get('/api/auth/google/callback', googleCallback)
app.get('/api/auth/github', startGithub)
app.get('/api/auth/github/callback', githubCallback)
app.get('/api/me', me)
app.route('/api/items', itemsRouter)
app.route('/api/files', filesRouter)
app.route('/api/products', productsRouter)
app.route('/api/orders', ordersRouter)
app.route('/api/payments', paymentsRouter)
app.route('/api/webhooks', webhooksRouter)
app.route('/api/mail', mailRouter)
app.route('/api/admin', adminRouter)

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

await migrateAppSchema()

const requestListener = getRequestListener(app.fetch)
const httpServer = createServer((req, res) => {
  if (req.url?.startsWith('/socket.io')) {
    return
  }
  void requestListener(req, res)
})
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
})
setRealtimeServer(io)

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`App API listening on http://127.0.0.1:${PORT} schema=${APP_SCHEMA}`)
})
