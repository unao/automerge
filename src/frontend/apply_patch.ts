import { ROOT_ID, isObject } from '../common'
import { OBJECT_ID, CONFLICTS, ELEM_IDS, MAX_ELEM } from './constants'
import { Text } from './text'
import { Table, instantiateTable } from './table'

import { ElementId, Diff, ReferenceData, DateData, Key, ObjectId, Ref, Inbound, Conflict, ListDiff } from '../types'

/**
 * Takes a string in the form that is used to identify list elements (an actor
 * ID concatenated with a counter, separated by a colon) and returns a
 * two-element array, `[counter, actorId]`.
 */
function parseElemId (elemId: ElementId) {
  const match = /^(.*):(\d+)$/.exec(elemId || '')
  if (!match) {
    throw new RangeError(`Not a valid elemId: ${elemId}`)
  }
  return [parseInt(match[2], 10), match[1]] as [number, string]
}

/**
 * Reconstructs the value from the diff object `diff`.
 */
function getValue (diff: Diff, cache: any, updated: any) {
  if ((diff as ReferenceData).link) {
    // Reference to another object; fetch it from the cache
    return updated[(diff as ReferenceData).value] || cache[(diff as ReferenceData).value]
  } else if ((diff as DateData).datatype === 'timestamp') {
    // Timestamp: value is milliseconds since 1970 epoch
    return new Date((diff as DateData).value)
  } else if ((diff as any).datatype !== undefined) {
    throw new TypeError(`Unknown datatype: ${(diff as any).datatype}`)
  } else {
    // Primitive value (number, string, boolean, or null)
    return diff.value
  }
}

/**
 * Finds the object IDs of all child objects referenced under the key `key` of
 * `object` (both `object[key]` and any conflicts under that key). Returns a map
 * from those objectIds to the value `true`.
 */
function childReferences (object: any, key: Key | number) {
  const refs = {} as any
  const conflicts = object[CONFLICTS][key] || {}
  const children = [object[key]].concat(Object.values(conflicts))
  for (let child of children) {
    if (isObject(child)) {
      refs[child[OBJECT_ID]] = true
    }
  }
  return refs
}

/**
 * Updates `inbound` (a mapping from each child object ID to its parent) based
 * on a change to the object with ID `objectId`. `refsBefore` and `refsAfter`
 * are objects produced by the `childReferences()` function, containing the IDs
 * of child objects before and after the change, respectively.
 */
function updateInbound (objectId: ObjectId, refsBefore: Ref, refsAfter: Ref, inbound: Inbound) {
  for (let ref of Object.keys(refsBefore)) {
    if (!refsAfter[ref]) delete inbound[ref]
  }
  for (let ref of Object.keys(refsAfter)) {
    if (inbound[ref] && inbound[ref] !== objectId) {
      throw new RangeError(`Object ${ref} has multiple parents`)
    } else if (!inbound[ref]) {
      inbound[ref] = objectId
    }
  }
}

/**
 * Creates a writable copy of an immutable map object. If `originalObject`
 * is undefined, creates an empty object with ID `objectId`.
 */
function cloneMapObject (originalObject: any, objectId: ObjectId) {
  if (originalObject && originalObject[OBJECT_ID] !== objectId) {
    throw new RangeError(`cloneMapObject ID mismatch: ${originalObject[OBJECT_ID]} !== ${objectId}`)
  }
  let object = Object.assign({}, originalObject)
  let conflicts = Object.assign({}, originalObject ? originalObject[CONFLICTS] : undefined)
  Object.defineProperty(object, CONFLICTS, { value: conflicts })
  Object.defineProperty(object, OBJECT_ID, { value: objectId })
  return object
}

/**
 * Applies the change `diff` to a map object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateMapObject (diff: Diff, cache: any, updated: any, inbound: Inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cloneMapObject(cache[diff.obj], diff.obj)
  }
  const object = updated[diff.obj]
  const conflicts = object[CONFLICTS] as { [K in Key]: Conflict } // FIXME
  let refsBefore: Ref = {}
  let refsAfter: Ref = {}

  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'set') {
    // FIXME -- 'set' requires key
    refsBefore = childReferences(object, diff.key as Key)
    object[diff.key as Key] = getValue(diff, cache, updated)
    if (diff.conflicts) {
      conflicts[diff.key as Key] = {} as Conflict // FIXME
      for (let conflict of diff.conflicts) {
        (conflicts[diff.key as Key] as any)[conflict.actor] = getValue(conflict as any, cache, updated)
      }
      Object.freeze(conflicts[diff.key as Key])
    } else {
      delete conflicts[diff.key as Key]
    }
    refsAfter = childReferences(object, diff.key as Key)
  } else if (diff.action === 'remove') {
    refsBefore = childReferences(object, diff.key as Key)
    delete object[diff.key as Key]
    delete conflicts[diff.key as Key]
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the map object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentMapObject (objectId: ObjectId, cache: any, updated: any) {
  if (!updated[objectId]) {
    updated[objectId] = cloneMapObject(cache[objectId], objectId)
  }
  let object = updated[objectId]

  for (let key of Object.keys(object)) {
    let value = object[key]
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      object[key] = updated[value[OBJECT_ID]]
    }

    const conflicts = object[CONFLICTS][key] || {}
    let conflictsUpdate = null as any
    for (let actorId of Object.keys(conflicts)) {
      value = conflicts[actorId]
      if (isObject(value) && updated[value[OBJECT_ID]]) {
        if (!conflictsUpdate) {
          conflictsUpdate = Object.assign({}, conflicts)
          object[CONFLICTS][key] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * Applies the change `diff` to a table object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateTableObject (diff: Diff, cache: any, updated: any, inbound: Inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cache[diff.obj] ? cache[diff.obj]._clone() : instantiateTable(diff.obj)
  }
  const object = updated[diff.obj]
  let refsBefore: Ref = {}
  let refsAfter: Ref = {}

  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'set') {
    const previous = object.byId(diff.key)
    if (isObject(previous)) refsBefore[previous[OBJECT_ID]] = true
    if ((diff as ReferenceData).link) {
      object.set(diff.key, updated[(diff as ReferenceData).value] || cache[(diff as ReferenceData).value])
      refsAfter[(diff as ReferenceData).value] = true
    } else {
      object.set(diff.key, diff.value)
    }
  } else if (diff.action === 'remove') {
    const previous = object.byId(diff.key)
    if (isObject(previous)) refsBefore[previous[OBJECT_ID]] = true
    object.remove(diff.key)
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the table object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentTableObject (objectId: ObjectId, cache: any, updated: any) {
  if (!updated[objectId]) {
    updated[objectId] = cache[objectId]._clone()
  }
  let table = updated[objectId]

  for (let key of Object.keys(table.entries)) {
    let value = table.byId(key)
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      table.set(key, updated[value[OBJECT_ID]])
    }
  }
}

/**
 * Creates a writable copy of an immutable list object. If `originalList` is
 * undefined, creates an empty list with ID `objectId`.
 */
function cloneListObject (originalList: any, objectId: ObjectId) {
  if (originalList && originalList[OBJECT_ID] !== objectId) {
    throw new RangeError(`cloneListObject ID mismatch: ${originalList[OBJECT_ID]} !== ${objectId}`)
  }
  let list = originalList ? originalList.slice() : [] // slice() makes a shallow clone
  let conflicts = (originalList && originalList[CONFLICTS]) ? originalList[CONFLICTS].slice() : []
  let elemIds = (originalList && originalList[ELEM_IDS]) ? originalList[ELEM_IDS].slice() : []
  let maxElem = (originalList && originalList[MAX_ELEM]) ? originalList[MAX_ELEM] : 0
  Object.defineProperty(list, OBJECT_ID, { value: objectId })
  Object.defineProperty(list, CONFLICTS, { value: conflicts })
  Object.defineProperty(list, ELEM_IDS, { value: elemIds })
  Object.defineProperty(list, MAX_ELEM, { value: maxElem, writable: true })
  return list
}

/**
 * Applies the change `diff` to a list object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateListObject (diff: ListDiff, cache: any, updated: any, inbound: Inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cloneListObject(cache[diff.obj], diff.obj)
  }
  const list = updated[diff.obj]
  const conflicts = list[CONFLICTS]
  const elemIds = list[ELEM_IDS]
  let value = null
  let conflict = null

  if (['insert', 'set'].includes(diff.action)) {
    value = getValue(diff, cache, updated)
    if (diff.conflicts) {
      conflict = {} as any
      for (let c of diff.conflicts) {
        conflict[c.actor] = getValue(c as any, cache, updated)
      }
      Object.freeze(conflict)
    }
  }

  let refsBefore: Ref = {}
  let refsAfter: Ref = {}
  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'insert') {
    list[MAX_ELEM] = Math.max(list[MAX_ELEM], parseElemId(diff.elemId)[0])
    list.splice(diff.index, 0, value)
    conflicts.splice(diff.index, 0, conflict)
    elemIds.splice(diff.index, 0, diff.elemId)
    refsAfter = childReferences(list, diff.index)
  } else if (diff.action === 'set') {
    refsBefore = childReferences(list, diff.index)
    list[diff.index] = value
    conflicts[diff.index] = conflict
    refsAfter = childReferences(list, diff.index)
  } else if (diff.action === 'remove') {
    refsBefore = childReferences(list, diff.index)
    list.splice(diff.index, 1)
    conflicts.splice(diff.index, 1)
    elemIds.splice(diff.index, 1)
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the list object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentListObject (objectId: ObjectId, cache: any, updated: any) {
  if (!updated[objectId]) {
    updated[objectId] = cloneListObject(cache[objectId], objectId)
  }
  let list = updated[objectId]

  for (let index = 0; index < list.length; index++) {
    let value = list[index]
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      list[index] = updated[value[OBJECT_ID]]
    }

    const conflicts = list[CONFLICTS][index] || {}
    let conflictsUpdate = null
    for (let actorId of Object.keys(conflicts)) {
      value = conflicts[actorId]
      if (isObject(value) && updated[value[OBJECT_ID]]) {
        if (!conflictsUpdate) {
          conflictsUpdate = Object.assign({}, conflicts)
          list[CONFLICTS][index] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * Applies the list of changes from `diffs[startIndex]` to `diffs[endIndex]`
 * (inclusive the last element) to a Text object. `cache` and `updated` are
 * indexed by objectId; the existing read-only object is taken from `cache`,
 * and the updated object is written to `updated`.
 */
function updateTextObject (diffs: ListDiff[], startIndex: number, endIndex: number, cache: any, updated: any) {
  // TODO: make sure that ListDiff works for Text
  const objectId = diffs[startIndex].obj
  if (!updated[objectId]) {
    if (cache[objectId]) {
      const elems = cache[objectId].elems.slice()
      const maxElem = cache[objectId][MAX_ELEM]
      updated[objectId] = new Text(objectId, elems, maxElem)
    } else {
      updated[objectId] = new Text(objectId)
    }
  }

  const elems = updated[objectId].elems
  let maxElem = updated[objectId][MAX_ELEM]
  let splicePos = -1
  let deletions: number
  let insertions

  while (startIndex <= endIndex) {
    const diff = diffs[startIndex]
    if (diff.action === 'create') {
      // do nothing

    } else if (diff.action === 'insert') {
      if (splicePos < 0) {
        splicePos = diff.index
        deletions = 0
        insertions = []
      }
      maxElem = Math.max(maxElem, parseElemId(diff.elemId)[0])
      ;(insertions as any).push({ elemId: diff.elemId, value: diff.value, conflicts: diff.conflicts })

      if (startIndex === endIndex || diffs[startIndex + 1].action !== 'insert' ||
        diffs[startIndex + 1].index !== diff.index + 1) {
        elems.splice(splicePos, deletions!, ...insertions as any)
        splicePos = -1
      }

    } else if (diff.action === 'set') {
      elems[diff.index] = {
        elemId: elems[diff.index].elemId,
        value: diff.value,
        conflicts: diff.conflicts
      }

    } else if (diff.action === 'remove') {
      if (splicePos < 0) {
        splicePos = diff.index
        deletions = 0
        insertions = []
      }
      deletions! += 1

      if (startIndex === endIndex ||
        !['insert', 'remove'].includes(diffs[startIndex + 1].action) ||
        diffs[startIndex + 1].index !== diff.index) {
        elems.splice(splicePos, deletions!)
        splicePos = -1
      }
    } else {
      throw new RangeError('Unknown action type: ' + diff.action)
    }

    startIndex += 1
  }
  updated[objectId] = new Text(objectId, elems, maxElem)
}

/**
 * After some set of objects in `updated` (a map from object ID to mutable
 * object) have been updated, updates their parent objects to point to the new
 * object versions, all the way to the root object. `cache` contains the
 * previous (immutable) version of all objects, and `inbound` is the mapping
 * from child objectId to parent objectId. Any objects that were not modified
 * continue to refer to the existing version in `cache`.
 */
export function updateParentObjects (cache: any, updated: any, inbound: Inbound) {
  let affected = updated
  while (Object.keys(affected).length > 0) {
    let parents = {} as any
    for (let childId of Object.keys(affected)) {
      const parentId = inbound[childId]
      if (parentId) parents[parentId] = true
    }
    affected = parents

    for (let objectId of Object.keys(parents)) {
      if (Array.isArray(updated[objectId] || cache[objectId])) {
        parentListObject(objectId, cache, updated)
      } else if ((updated[objectId] || cache[objectId]) instanceof Table) {
        parentTableObject(objectId, cache, updated)
      } else {
        parentMapObject(objectId, cache, updated)
      }
    }
  }
}

/**
 * Applies the list of changes `diffs` to the appropriate object in `updated`.
 * `cache` and `updated` are indexed by objectId; the existing read-only object
 * is taken from `cache`, and the updated writable object is written to
 * `updated`. `inbound` is a mapping from child objectId to parent objectId;
 * it is updated according to the change.
 */
export function applyDiffs (diffs: Diff[], cache: any, updated: any, inbound: Inbound) {
  let startIndex = 0
  for (let endIndex = 0; endIndex < diffs.length; endIndex++) {
    const diff = diffs[endIndex]

    if (diff.type === 'map') {
      updateMapObject(diff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'table') {
      updateTableObject(diff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'list') {
      updateListObject(diff as ListDiff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'text') {
      if (endIndex === diffs.length - 1 || diffs[endIndex + 1].obj !== diff.obj) {
        updateTextObject(diffs as ListDiff[], startIndex, endIndex, cache, updated)
        startIndex = endIndex + 1
      }
    } else {
      throw new TypeError(`Unknown object type: ${diff.type}`)
    }
  }
}

/**
 * Creates a writable copy of the immutable document root object `root`.
 */
export function cloneRootObject (root: any) {
  if (root[OBJECT_ID] !== ROOT_ID) {
    throw new RangeError(`Not the root object: ${root[OBJECT_ID]}`)
  }
  return cloneMapObject(root, ROOT_ID)
}
