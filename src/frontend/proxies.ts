import { ROOT_ID } from '../common'
import { CHANGE } from './constants'
import { Text } from './text'
import { Table } from './table'
import { Key, ObjectId } from '../types'
import { Context } from './context'

export type InstantiateProxy = typeof instantiateProxy

function parseListIndex (key: Key | number) {
  if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key, 10)
  if (typeof key !== 'number') {
    throw new TypeError('A list index must be a number, but you passed ' + JSON.stringify(key))
  }
  if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity) {
    throw new RangeError('A list index must be positive, but you passed ' + key)
  }
  return key
}

function listMethods (context: Context, listId: ObjectId) {
  const methods = {
    deleteAt (index: number, numDelete: number) {
      context.splice(listId, parseListIndex(index), numDelete || 1, [])
      return this
    },

    fill (value: any, start: number, end: number) {
      let list = context.getObject(listId)
      for (let index = parseListIndex(start || 0); index < parseListIndex(end || list.length); index++) {
        context.setListIndex(listId, index, value)
      }
      return this
    },

    insertAt (index: number, ...values: any[]) {
      context.splice(listId, parseListIndex(index), 0, values)
      return this
    },

    pop () {
      let list = context.getObject(listId)
      if (list.length === 0) return
      const last = context.getObjectField(listId, list.length - 1)
      context.splice(listId, list.length - 1, 1, [])
      return last
    },

    push (...values: any[]) {
      let list = context.getObject(listId)
      context.splice(listId, list.length, 0, values)
      // need to getObject() again because the list object above may be immutable
      return context.getObject(listId).length
    },

    shift () {
      let list = context.getObject(listId)
      if (list.length === 0) return
      const first = context.getObjectField(listId, 0)
      context.splice(listId, 0, 1, [])
      return first
    },

    splice (start: number, deleteCount: number, ...values: any[]) {
      let list = context.getObject(listId)
      start = parseListIndex(start)
      if (deleteCount === undefined) {
        deleteCount = list.length - start
      }
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(context.getObjectField(listId, start + n))
      }
      context.splice(listId, start, deleteCount, values)
      return deleted
    },

    unshift (...values: any[]) {
      context.splice(listId, 0, 0, values)
      return context.getObject(listId).length
    }
  }

  for (let iterator of ['entries', 'keys', 'values']) {
    let list = context.getObject(listId)
    ;(methods as any)[iterator] = () => list[iterator]()
  }

  // TODO: Reflect in typescript
  // Read-only methods that can delegate to the JavaScript built-in implementations
  for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
    'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
    'slice', 'some', 'toLocaleString', 'toString']) {
    (methods as any)[method] = (...args: any) => {
      const list = context.getObject(listId)
      return list[method].call(list, ...args)
    }
  }

  return methods
}

const MapHandler = {
  // FIXME: improve typing with conditional types
  get (target: any, key: Key | typeof CHANGE): any {
    const { context, objectId } = target
    if (key === '_inspect') return JSON.parse(JSON.stringify(mapProxy(context, objectId)))
    if (key === '_type') return 'map'
    if (key === '_objectId') return objectId
    if (key === CHANGE) return context
    if (key === '_get') return context._get
    return context.getObjectField(objectId, key)
  },

  set (target: any, key: Key, value: any) {
    const { context, objectId } = target
    context.setMapKey(objectId, 'map', key, value)
    return true
  },

  deleteProperty (target: any, key: Key) {
    const { context, objectId } = target
    context.deleteMapKey(objectId, key)
    return true
  },

  has (target: any, key: Key) {
    const { context, objectId } = target
    return ['_type', '_objectId', CHANGE, '_get'].includes(key) || (key in context.getObject(objectId))
  },

  getOwnPropertyDescriptor (target: any, key: Key) {
    const { context, objectId } = target
    const object = context.getObject(objectId)
    if (key in object) {
      return { configurable: true, enumerable: true }
    }
  },

  ownKeys (target: any) {
    const { context, objectId } = target
    return Object.keys(context.getObject(objectId))
  }
}

const ListHandler = {
  get (target: any, key: Key | typeof CHANGE): any {
    const [context, objectId] = target
    if (key === Symbol.iterator) return context.getObject(objectId)[Symbol.iterator]
    if (key === '_inspect') return JSON.parse(JSON.stringify(listProxy(context, objectId)))
    if (key === '_type') return 'list'
    if (key === '_objectId') return objectId
    if (key === CHANGE) return context
    if (key === 'length') return context.getObject(objectId).length
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return context.getObjectField(objectId, parseListIndex(key))
    }
    return (listMethods(context, objectId) as any)[key]
  },

  set (target: any, key: Key, value: any) {
    const [context, objectId] = target
    context.setListIndex(objectId, parseListIndex(key), value)
    return true
  },

  deleteProperty (target: any, key: Key) {
    const [context, objectId] = target
    context.splice(objectId, parseListIndex(key), 1, [])
    return true
  },

  has (target: any, key: Key) {
    const [context, objectId] = target
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseListIndex(key) < context.getObject(objectId).length
    }
    return ['length', '_type', '_objectId', CHANGE].includes(key)
  },

  getOwnPropertyDescriptor (target: any, key: Key) {
    if (key === 'length') return {}
    if (key === '_objectId') return { configurable: true, enumerable: false }

    const [context, objectId] = target
    const object = context.getObject(objectId)

    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      const index = parseListIndex(key)
      if (index < object.length) return { configurable: true, enumerable: true }
    }
  },

  ownKeys (target: any) {
    const [context, objectId] = target
    const object = context.getObject(objectId)
    let keys = ['length', '_objectId']
    keys.push(...Object.keys(object))
    return keys
  }
}

function mapProxy (context: any, objectId: ObjectId) {
  return new Proxy({ context, objectId }, MapHandler)
}

function listProxy (context: any, objectId: ObjectId) {
  return new Proxy([context, objectId], ListHandler)
}

/**
 * Instantiates a proxy object for the given `objectId`.
 * This function is added as a method to the context object by rootObjectProxy().
 * When it is called, `this` is the context object.
 */
function instantiateProxy (this: any, objectId: ObjectId) { // FIXME: this
  const object = this.getObject(objectId)
  if (Array.isArray(object) || (object instanceof Text)) {
    return listProxy(this, objectId)
  } else if (object instanceof Table) {
    return object.getWriteable(this)
  } else {
    return mapProxy(this, objectId)
  }
}

export function rootObjectProxy (context: Context) {
  context.instantiateObject = instantiateProxy
  context._get = (objId: ObjectId) => instantiateProxy.call(context, objId)
  return mapProxy(context, ROOT_ID)
}
