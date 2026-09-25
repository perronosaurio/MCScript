'use strict'

// Event bus with priorities and cancellable events.
//
//   const off = server.events.on('playerChat', (ev) => { if (bad(ev.message)) ev.cancel() }, { priority: 'high' })
//   off() // unsubscribe
//
// Priorities run in this order: critical, high, normal, low, monitor.
// 'monitor' handlers should only observe (logging, relays) and never modify the event.

const PRIORITIES = { critical: 0, high: 1, normal: 2, low: 3, monitor: 4 }

class EventBus {
  constructor (log) {
    this.log = log
    this.handlers = new Map()
  }

  on (name, handler, opts = {}) {
    const priority = PRIORITIES[opts.priority || 'normal']
    if (priority === undefined) throw new Error(`Unknown priority ${opts.priority}`)
    const list = this.handlers.get(name) || []
    const entry = { handler, priority, owner: opts.owner || null }
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority)
    this.handlers.set(name, list)
    return () => this.off(name, handler)
  }

  once (name, handler, opts) {
    const off = this.on(name, (ev) => { off(); return handler(ev) }, opts)
    return off
  }

  off (name, handler) {
    const list = this.handlers.get(name)
    if (!list) return
    const i = list.findIndex(e => e.handler === handler)
    if (i !== -1) list.splice(i, 1)
  }

  // Fires an event. `data` becomes the event object; it gains cancel()/cancelled.
  // Handlers of a cancelled event still run if they are 'monitor' handlers.
  fire (name, data = {}) {
    const ev = data
    ev.type = name
    ev.cancelled = false
    ev.cancelReason = null
    ev.cancel = (reason) => { ev.cancelled = true; if (reason) ev.cancelReason = reason }
    const list = this.handlers.get(name)
    if (!list) return ev
    for (const entry of [...list]) {
      if (ev.cancelled && entry.priority !== PRIORITIES.monitor) continue
      try {
        entry.handler(ev)
      } catch (err) {
        const who = entry.owner ? ` (plugin ${entry.owner})` : ''
        if (this.log) this.log.error(`Error in ${name} handler${who}:`, err)
      }
    }
    return ev
  }

  removeOwner (owner) {
    for (const list of this.handlers.values()) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) list.splice(i, 1)
    }
  }
}

module.exports = { EventBus, PRIORITIES }
