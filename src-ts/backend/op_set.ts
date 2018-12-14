import { Map, List, Set } from 'immutable'
import { SkipList } from './skip_list'
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

type OpSet = Map<any, any>
type Op = Map<any, any>
type Change = Map<any, any>
type Dep = any
type Seq = number
type Actor = string
type ObjectId = string
type ElementId = string
type DataType = any
type State = Map<any, any>

type Context = any

type Key = string
type Path = Key[] | null

interface Conflict { actor: Actor, value: any, link?: boolean }

type OpActionT = 'makeMap' | 'makeTable' | 'makeText' | 'link' /* 'makeList' */
type ActionT = 'create' | 'insert' | 'set' | 'remove'
type ItemT = 'map' | 'table' | 'text' | 'list'

type ListIteratorMode = 'keys' | 'values' | 'entries' | 'elems' | 'conflicts'

interface Edit {
  action: ActionT, obj: ObjectId, type: ItemT,
  key: Key, value: any, datatype: DataType, elemId: ElementId,
  link: boolean, index: number, path: Path, conflicts: Conflict[]
}

interface Result {
  value: any
  datatype: DataType
}

// Returns true if the two operations are concurrent, that is, they happened without being aware of
// each other (neither happened before the other). Returns false if one supersedes the other.
function isConcurrent (opSet: OpSet, op1: Op, op2: Op) {
  const [actor1, seq1] = [op1.get('actor'), op1.get('seq')]
  const [actor2, seq2] = [op2.get('actor'), op2.get('seq')]
  if (!actor1 || !actor2 || !seq1 || !seq2) return false

  const clock1 = opSet.getIn(['states', actor1, seq1 - 1, 'allDeps'])
  const clock2 = opSet.getIn(['states', actor2, seq2 - 1, 'allDeps'])

  return clock1.get(actor2, 0) < seq2 && clock2.get(actor1, 0) < seq1
}

// Returns true if all changes that causally precede the given change
// have already been applied in `opSet`.
function causallyReady (opSet: OpSet, change: Change) {
  const actor = change.get('actor')
  const seq = change.get('seq')
  let satisfied = true
  change.get('deps').set(actor, seq - 1).forEach((depSeq: Seq, depActor: Actor) => {
    if (opSet.getIn(['clock', depActor], 0) < depSeq) satisfied = false
  })
  return satisfied
}

function transitiveDeps (opSet: OpSet, baseDeps: Dep[]) {
  return baseDeps.reduce((deps, depSeq, depActor) => {
    if (depSeq <= 0) return deps
    const transitive = opSet.getIn(['states', depActor, depSeq - 1, 'allDeps'])
    return deps
      .mergeWith((a: any, b: any) => Math.max(a, b), transitive)
      .set(depActor, depSeq)
  }, Map())
}

// Returns the path from the root object to the given objectId, as an array of string keys
// (for ancestor maps) and integer indexes (for ancestor lists). If there are several paths
// to the same object, returns one of the paths arbitrarily. If the object is not reachable
// from the root, returns null.
function getPath (opSet: OpSet, objectId: ObjectId) {
  let path: string[] = []
  while (objectId !== ROOT_ID) {
    const ref = opSet.getIn(['byObject', objectId, '_inbound'], Set()).first()
    if (!ref) return null
    objectId = ref.get('obj')
    const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])

    if (objType === 'makeList' || objType === 'makeText') {
      const index = opSet.getIn(['byObject', objectId, '_elemIds']).indexOf(ref.get('key'))
      if (index < 0) return null
      path.unshift(index)
    } else {
      path.unshift(ref.get('key'))
    }
  }
  return path
}

// Processes a 'makeMap', 'makeList', or 'makeText' operation
function applyMake (opSet: OpSet, op: Op) {
  const objectId = op.get('obj')
  if (opSet.hasIn(['byObject', objectId])) throw new Error('Duplicate creation of object ' + objectId)

  let edit = { action: 'create', obj: objectId } as Edit
  let object = Map({ _init: op, _inbound: Set() })
  if (op.get('action') === 'makeMap') {
    edit.type = 'map'
  } else if (op.get('action') === 'makeTable') {
    edit.type = 'table'
  } else {
    edit.type = (op.get('action') === 'makeText') ? 'text' : 'list'
    object = object.set('_elemIds', new SkipList() as any)
  }

  opSet = opSet.setIn(['byObject', objectId], object)
  return [opSet, [edit]]
}

// Processes an 'ins' operation. Does not produce any diffs since the insertion alone
// produces no application-visible effect; the list element only becomes visible through
// a subsequent 'set' or 'link' operation on the inserted element.
function applyInsert (opSet: OpSet, op: Op) {
  const objectId: ObjectId = op.get('obj')
  const elem = op.get('elem')
  const elemId = op.get('actor') + ':' + elem
  if (!opSet.get('byObject').has(objectId)) throw new Error('Modification of unknown object ' + objectId)
  if (opSet.hasIn(['byObject', objectId, '_insertion', elemId])) throw new Error('Duplicate list element ID ' + elemId)

  opSet = opSet
    .updateIn(['byObject', objectId, '_following', op.get('key')], List(), list => list.push(op))
    .updateIn(['byObject', objectId, '_maxElem'], 0, maxElem => Math.max(elem, maxElem))
    .setIn(['byObject', objectId, '_insertion', elemId], op)
  return [opSet, []]
}

function getConflicts (ops: List<Op>) {
  const conflicts: Conflict[] = []
  for (let op of (ops as any).shift()) {
    const conflict: Conflict = { actor: op.get('actor'), value: op.get('value') }
    if (op.get('action') === 'link') conflict.link = true
    conflicts.push(conflict)
  }
  return conflicts
}

function patchList (opSet: OpSet, objectId: ObjectId, index: number, elemId: ElementId,
  action: ActionT, ops: List<Op> | null) {
  const type = (opSet.getIn(['byObject', objectId, '_init', 'action']) === 'makeText') ? 'text' : 'list'
  const firstOp = ops ? ops.first() : null
  let elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let value = firstOp ? firstOp.get('value') : null
  const edit: Partial<Edit> = { action, type, obj: objectId, index, path: getPath(opSet, objectId) }
  if (firstOp && firstOp.get('action') === 'link') {
    edit.link = true
    value = { obj: firstOp.get('value') }
  }

  if (action === 'insert') {
    // FIXME - firstOp! indicates firstOp _may_ be null
    elemIds = elemIds.insertIndex(index, firstOp!.get('key'), value)
    edit.elemId = elemId
    edit.value = firstOp!.get('value')
    if (firstOp!.get('datatype')) edit.datatype = firstOp!.get('datatype')
  } else if (action === 'set') {
    elemIds = elemIds.setValue(firstOp!.get('key'), value)
    edit.value = firstOp!.get('value')
    if (firstOp!.get('datatype')) edit.datatype = firstOp!.get('datatype')
  } else if (action === 'remove') {
    elemIds = elemIds.removeIndex(index)
  } else throw new Error('Unknown action type: ' + action)

  if (ops && ops.size > 1) edit.conflicts = getConflicts(ops)
  opSet = opSet.setIn(['byObject', objectId, '_elemIds'], elemIds)
  return [opSet, [edit]]
}

function updateListElement (opSet: OpSet, objectId: ObjectId, elemId: ElementId) {
  const ops = getFieldOps(opSet, objectId, elemId)
  const elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let index = elemIds.indexOf(elemId)

  if (index >= 0) {
    if (ops.isEmpty()) {
      return patchList(opSet, objectId, index, elemId, 'remove', null)
    } else {
      return patchList(opSet, objectId, index, elemId, 'set', ops)
    }

  } else {
    if (ops.isEmpty()) return [opSet, []] // deleting a non-existent element = no-op

    // find the index of the closest preceding list element
    let prevId = elemId
    while (true) {
      index = -1
      prevId = getPrevious(opSet, objectId, prevId)
      if (!prevId) break
      index = elemIds.indexOf(prevId)
      if (index >= 0) break
    }

    return patchList(opSet, objectId, index + 1, elemId, 'insert', ops)
  }
}

function updateMapKey (opSet: OpSet, objectId: ObjectId, type: ItemT, key: string) {
  const ops = getFieldOps(opSet, objectId, key)
  const firstOp = ops.first()
  let edit: Partial<Edit> = { type, obj: objectId, key, path: getPath(opSet, objectId) }

  if (ops.isEmpty()) {
    edit.action = 'remove'
  } else {
    edit.action = 'set'
    edit.value = firstOp.get('value')
    if (firstOp.get('action') === 'link') {
      edit.link = true
    }
    if (firstOp.get('datatype')) {
      edit.datatype = firstOp.get('datatype')
    }

    if (ops.size > 1) edit.conflicts = getConflicts(ops)
  }
  return [opSet, [edit]]
}

// Processes a 'set', 'del', or 'link' operation
function applyAssign (opSet: OpSet, op: Op, topLevel: boolean) {
  const objectId = op.get('obj')
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  if (!opSet.get('byObject').has(objectId)) throw new Error('Modification of unknown object ' + objectId)

  if (opSet.has('undoLocal') && topLevel) {
    let undoOps = opSet.getIn(['byObject', objectId, op.get('key')], List())
      // todo: figure out ref type
      .map((ref: Map<any, any>) => ref.filter((v, k) => ['action', 'obj', 'key', 'value'].includes(k)))
    if (undoOps.isEmpty()) {
      undoOps = List.of(Map({ action: 'del', obj: objectId, key: op.get('key') }))
    }
    opSet = opSet.update('undoLocal', undoLocal => undoLocal.concat(undoOps))
  }

  const priorOpsConcurrent = opSet
    .getIn(['byObject', objectId, op.get('key')], List())
    .groupBy((other: any) => !!isConcurrent(opSet, other, op))
  let overwritten = priorOpsConcurrent.get(false, List())
  let remaining = priorOpsConcurrent.get(true, List())

  // If any links were overwritten, remove them from the index of inbound links
  for (let op of overwritten.filter((op: Op) => op.get('action') === 'link')) {
    opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], ops => ops.remove(op))
  }

  if (op.get('action') === 'link') {
    opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], Set(), ops => ops.add(op))
  }
  if (op.get('action') !== 'del') {
    remaining = remaining.push(op)
  }
  remaining = remaining.sortBy((op: Op) => op.get('actor')).reverse()
  opSet = opSet.setIn(['byObject', objectId, op.get('key')], remaining)

  if (objectId === ROOT_ID || objType === 'makeMap') {
    return updateMapKey(opSet, objectId, 'map', op.get('key'))
  } else if (objType === 'makeTable') {
    return updateMapKey(opSet, objectId, 'table', op.get('key'))
  } else if (objType === 'makeList' || objType === 'makeText') {
    return updateListElement(opSet, objectId, op.get('key'))
  } else {
    throw new RangeError(`Unknown operation type ${objType}`)
  }
}

function applyOps (opSet: OpSet, ops: List<Op>) {
  const allDiffs = []
  let newObjects = Set()
  for (let op of (ops as any as Op[])) {
    let diffs: any
    const action = op.get('action')
    if (['makeMap', 'makeList', 'makeText', 'makeTable'].includes(action)) {
      newObjects = newObjects.add(op.get('obj'))
      ;[opSet as any, diffs] = applyMake(opSet, op)
    } else if (action === 'ins') {
      [opSet as any, diffs] = applyInsert(opSet, op)
    } else if (action === 'set' || action === 'del' || action === 'link') {
      [opSet as any, diffs] = applyAssign(opSet, op, !newObjects.contains(op.get('obj')))
    } else {
      throw new RangeError(`Unknown operation type ${action}`)
    }
    allDiffs.push(...diffs)
  }
  return [opSet, allDiffs]
}

function applyChange (opSet: OpSet, change: Change) {
  const actor = change.get('actor')
  const seq = change.get('seq')
  const prior = opSet.getIn(['states', actor], List())
  if (seq <= prior.size) {
    if (!prior.get(seq - 1).get('change').equals(change)) {
      throw new Error('Inconsistent reuse of sequence number ' + seq + ' by ' + actor)
    }
    return [opSet, []] // change already applied, return unchanged
  }

  const allDeps = transitiveDeps(opSet, change.get('deps').set(actor, seq - 1))
  opSet = opSet.setIn(['states', actor], prior.push(Map({ change, allDeps })))

  let diffs: any
  const ops = change.get('ops').map((op: Op) => op.merge({ actor, seq }))
  ;[opSet as any, diffs] = applyOps(opSet, ops)

  const remainingDeps = opSet.get('deps')
    .filter((depSeq: Seq, depActor: Actor) => depSeq > allDeps.get(depActor, 0))
    .set(actor, seq)

  opSet = opSet
    .set('deps', remainingDeps)
    .setIn(['clock', actor], seq)
    .update('history', history => history.push(change))
  return [opSet, diffs]
}

function applyQueuedOps (opSet: OpSet) {
  let queue = List()
  let diff
  const diffs = []
  while (true) {
    for (let change of opSet.get('queue')) {
      if (causallyReady(opSet, change)) {
        [opSet, diff] = applyChange(opSet, change)
        diffs.push(...diff)
      } else {
        queue = queue.push(change)
      }
    }

    if (queue.count() === opSet.get('queue').count()) return [opSet, diffs]
    opSet = opSet.set('queue', queue)
    queue = List()
  }
}

function pushUndoHistory (opSet: OpSet) {
  const undoPos = opSet.get('undoPos')
  return opSet
    .update('undoStack', stack => {
      return stack
        .slice(0, undoPos)
        .push(opSet.get('undoLocal'))
    })
    .set('undoPos', undoPos + 1)
    .set('redoStack', List())
    .remove('undoLocal')
}

function init () {
  return Map()
    .set('states', Map())
    .set('history', List())
    .set('byObject', Map().set(ROOT_ID, Map()))
    .set('clock', Map())
    .set('deps', Map())
    .set('local', List())
    .set('undoPos', 0)
    .set('undoStack', List())
    .set('redoStack', List())
    .set('queue', List())
}

function addChange (opSet: OpSet, change: Change, isUndoable: boolean) {
  opSet = opSet.update('queue', queue => queue.push(change))

  if (isUndoable) {
    // setting the undoLocal key enables undo history capture
    opSet = opSet.set('undoLocal', List())
    let diffs
    [opSet as any, diffs] = applyQueuedOps(opSet)
    opSet = pushUndoHistory(opSet)
    return [opSet, diffs]
  } else {
    return applyQueuedOps(opSet)
  }
}

function getMissingChanges (opSet: OpSet, haveDeps: any[]) {
  const allDeps = transitiveDeps(opSet, haveDeps)
  return opSet.get('states')
    .map((states: List<State>, actor: Actor) => states.skip(allDeps.get(actor, 0)))
    .valueSeq()
    .flatten(1)
    .map((state: State) => state.get('change'))
}

function getChangesForActor (opSet: OpSet, forActor: Actor, afterSeq: Seq) {
  afterSeq = afterSeq || 0

  return opSet.get('states')
    .filter((states: List<State>, actor: Actor) => actor === forActor)
    .map((states: List<State>, actor: Actor) => states.skip(afterSeq))
    .valueSeq()
    .flatten(1)
    .map((state: State) => state.get('change'))
}

function getMissingDeps (opSet: OpSet) {
  let missing = {} as { [K in Actor]: Seq }
  for (let change of opSet.get('queue')) {
    const deps = change.get('deps').set(change.get('actor'), change.get('seq') - 1)
    deps.forEach((depSeq: Seq, depActor: Actor) => {
      if (opSet.getIn(['clock', depActor], 0) < depSeq) {
        missing[depActor] = Math.max(depSeq, missing[depActor] || 0)
      }
    })
  }
  return missing
}

function getFieldOps (opSet: OpSet, objectId: ObjectId, key: Key) {
  return opSet.getIn(['byObject', objectId, key], List())
}

function getParent (opSet: OpSet, objectId: ObjectId, key: Key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', objectId, '_insertion', key])
  if (!insertion) throw new TypeError('Missing index entry for list element ' + key)
  return insertion.get('key')
}

function lamportCompare (op1: Op, op2: Op) {
  if (op1.get('elem') < op2.get('elem')) return -1
  if (op1.get('elem') > op2.get('elem')) return 1
  if (op1.get('actor') < op2.get('actor')) return -1
  if (op1.get('actor') > op2.get('actor')) return 1
  return 0
}

function insertionsAfter (opSet: OpSet, objectId: ObjectId, parentId: ObjectId, childId?: ObjectId) {
  const match = /^(.*):(\d+)$/.exec(childId || '')
  const childKey = match ? Map({ actor: match[1], elem: parseInt(match[2], 10) }) : null

  return opSet
    .getIn(['byObject', objectId, '_following', parentId], List())
    .filter((op: Op) => (op.get('action') === 'ins'))
    .filter((op: Op) => !childKey || lamportCompare(op, childKey) < 0)
    .sort(lamportCompare)
    .reverse() // descending order
    .map((op: Op) => op.get('actor') + ':' + op.get('elem'))
}

function getNext (opSet: OpSet, objectId: ObjectId, key: Key) {
  const children = insertionsAfter(opSet, objectId, key)
  if (!children.isEmpty()) return children.first()

  let ancestor
  while (true) {
    ancestor = getParent(opSet, objectId, key)
    if (!ancestor) return
    const siblings = insertionsAfter(opSet, objectId, ancestor, key)
    if (!siblings.isEmpty()) return siblings.first()
    key = ancestor
  }
}

// Given the ID of a list element, returns the ID of the immediate predecessor list element,
// or null if the given list element is at the head.
function getPrevious (opSet: OpSet, objectId: ObjectId, key: Key) {
  const parentId = getParent(opSet, objectId, key)
  let children = insertionsAfter(opSet, objectId, parentId)
  if (children.first() === key) {
    if (parentId === '_head') return null; else return parentId
  }

  let prevId
  for (let child of children) {
    if (child === key) break
    prevId = child
  }
  while (true) {
    children = insertionsAfter(opSet, objectId, prevId)
    if (children.isEmpty()) return prevId
    prevId = children.last()
  }
}

function getOpValue (opSet: OpSet, op: Op, context: Context) {
  if (typeof op !== 'object' || op === null) return op
  if (op.get('action') === 'link') {
    return context.instantiateObject(opSet, op.get('value'))
  } else if (op.get('action') === 'set') {
    const result: Partial<Result> = { value: op.get('value') }
    if (op.get('datatype')) result.datatype = op.get('datatype')
    return result as Result
  } else {
    throw new TypeError(`Unexpected operation action: ${op.get('action')}`)
  }
}

function validFieldName (key: Key) {
  return (typeof key === 'string' && key !== '' && !key.startsWith('_'))
}

function isFieldPresent (opSet: OpSet, objectId: ObjectId, key: Key) {
  return validFieldName(key) && !getFieldOps(opSet, objectId, key).isEmpty()
}

function getObjectFields (opSet: OpSet, objectId: ObjectId) {
  return opSet.getIn(['byObject', objectId])
    .keySeq()
    .filter((key: Key) => isFieldPresent(opSet, objectId, key))
    .toSet()
}

function getObjectField (opSet: OpSet, objectId: ObjectId, key: Key, context: Context) {
  if (!validFieldName(key)) return undefined
  const ops = getFieldOps(opSet, objectId, key)
  if (!ops.isEmpty()) return getOpValue(opSet, ops.first(), context)
}

function getObjectConflicts (opSet: OpSet, objectId: ObjectId, context: Context) {
  return opSet.getIn(['byObject', objectId])
    .filter((field: any, key: Key) => validFieldName(key) && getFieldOps(opSet, objectId, key).size > 1)
    .mapEntries(([key, field]: [Key, any]) => [key, field.shift().toMap()
      .mapEntries(([idx, op]: [number, Op]) => [op.get('actor'), getOpValue(opSet, op, context)])
    ])
}

function listElemByIndex (opSet: OpSet, objectId: ObjectId, index: number, context: Context) {
  const elemId = opSet.getIn(['byObject', objectId, '_elemIds']).keyOf(index)
  if (elemId) {
    const ops = getFieldOps(opSet, objectId, elemId)
    if (!ops.isEmpty()) return getOpValue(opSet, ops.first(), context)
  }
}

function listLength (opSet: OpSet, objectId: ObjectId) {
  return opSet.getIn(['byObject', objectId, '_elemIds']).length
}

function listIterator (opSet: OpSet, listId: string, mode: ListIteratorMode, context: Context) {
  let elem = '_head'
  let index = -1
  const next = () => {
    while (elem) {
      elem = getNext(opSet, listId, elem)
      if (!elem) return { done: true }

      const ops = getFieldOps(opSet, listId, elem)
      if (!ops.isEmpty()) {
        const value = getOpValue(opSet, ops.first(), context)
        index += 1
        switch (mode) {
          case 'keys': return { done: false, value: index }
          case 'values': return { done: false, value: value }
          case 'entries': return { done: false, value: [index, value] }
          case 'elems': return { done: false, value: [index, elem] }
          case 'conflicts':
            let conflict = null
            if (ops.size > 1) {
              conflict = ops.shift().toMap()
                .mapEntries(([_, op]: [any, Op]) => [op.get('actor'), getOpValue(opSet, op, context)])
            }
            return { done: false, value: conflict }
        }
      }
    }
  }

  const iterator = { next }
  ;(iterator as any)[Symbol.iterator] = () => { return iterator }
  return iterator as unknown as Iterable<any>
}

export {
  init, addChange, getMissingChanges, getChangesForActor, getMissingDeps,
  getObjectFields, getObjectField, getObjectConflicts, getFieldOps,
  listElemByIndex, listLength, listIterator, ROOT_ID
}
