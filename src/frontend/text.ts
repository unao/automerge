import { OBJECT_ID, ELEM_IDS, MAX_ELEM } from './constants'
import { ObjectId } from '../types'

export class Text {
  constructor (objectId: ObjectId, readonly elems: any[] = [], readonly maxElem?: number) {
    return makeInstance(objectId, elems, maxElem)
  }

  get length () {
    return this.elems.length
  }

  get (index: number) {
    return this.elems[index].value
  }

  getElemId (index: number) {
    return this.elems[index].elemId
  }

  [Symbol.iterator] () {
    let elems = this.elems
    let index = -1
    return {
      next () {
        index += 1
        if (index < elems.length) {
          return { done: false, value: elems[index].value }
        } else {
          return { done: true }
        }
      }
    }
  }
}

// TODO: reflect in typescript
// Read-only methods that can delegate to the JavaScript built-in array
for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
  'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
  'slice', 'some', 'toLocaleString', 'toString']) {
  (Text as any).prototype[method] = function (...args: any[]) {
    const array = [...this]
    return array[method as any].call(array, ...args)
  }
}

function makeInstance (objectId: ObjectId, elems: any[] = [], maxElem?: number) {
  const instance = Object.create(Text.prototype)
  instance[OBJECT_ID] = objectId
  instance.elems = elems || []
  instance[MAX_ELEM] = maxElem || 0
  return instance
}

/**
 * Returns the elemId of the `index`-th element. `object` may be either
 * a list object or a Text object.
 */
export function getElemId (object: any, index: number) {
  return (object instanceof Text) ? object.getElemId(index) : object[ELEM_IDS][index]
}
