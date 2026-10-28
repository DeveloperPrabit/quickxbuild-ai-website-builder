import type { Server, Socket } from 'socket.io'
import { APP_SCHEMA } from './db'

export type ChangeAction = 'created' | 'updated' | 'deleted'

type PresenceUser = { id: string }

let io: Server | undefined
const presence = new Map<string, string>()

function emitPresence() {
  const users: PresenceUser[] = [...new Set(presence.values())].map((id) => ({ id }))
  io?.to(APP_SCHEMA).emit('presence:update', { users, count: users.length })
}

export function setRealtimeServer(server: Server) {
  io = server
  io.on('connection', (socket: Socket) => {
    void socket.join(APP_SCHEMA)
    const userId = typeof socket.handshake.auth?.userId === 'string'
      ? socket.handshake.auth.userId
      : `anon:${socket.id}`
    presence.set(socket.id, userId)
    emitPresence()
    socket.on('disconnect', () => {
      presence.delete(socket.id)
      emitPresence()
    })
  })
}

export function emitItemsChanged(payload: {
  action: ChangeAction
  itemId: string
  item?: unknown
}) {
  io?.to(APP_SCHEMA).emit('items:changed', payload)
}

export function emitFilesChanged(payload: {
  action: ChangeAction
  fileId: string
  file?: unknown
}) {
  io?.to(APP_SCHEMA).emit('files:changed', payload)
}

export function emitUsersChanged(payload: {
  action: ChangeAction
  userId: string
  user?: unknown
}) {
  io?.to(APP_SCHEMA).emit('users:changed', payload)
}

export function emitProductsChanged(payload: {
  action: ChangeAction
  productId: string
  product?: unknown
}) {
  io?.to(APP_SCHEMA).emit('products:changed', payload)
}

export function emitOrdersChanged(payload: {
  action: ChangeAction
  orderId: string
  order?: unknown
}) {
  io?.to(APP_SCHEMA).emit('orders:changed', payload)
}

export function emitPaymentsChanged(payload: {
  action: ChangeAction
  paymentId: string
  payment?: unknown
}) {
  io?.to(APP_SCHEMA).emit('payments:changed', payload)
}
