import transit from 'transit-immutable-js'
import uuid from './uuid'
import * as Frontend from './frontend'
import * as Backend from './backend'
import { isObject } from './common'
import { Actor, Change, Doc, Diff } from './types'

/**
 * Constructs a new frontend document that reflects the given list of changes.
 */
function docFromChanges (actorId: Actor, changes: Change[]) {
  if (!actorId) throw new RangeError('actorId is required in docFromChanges')
  const doc = Frontend.init({ actorId, backend: Backend })
  const [state, _] = Backend.applyChanges(Backend.init(), changes)
  const patch = Backend.getPatch(state as any)
  ;(patch as any).state = state
  return Frontend.applyPatch(doc, patch)
}

///// Automerge.* API

function init (actorId: Actor) {
  return Frontend.init({ actorId, backend: Backend })
}

function change (doc: Doc, message: string, callback: Function) {
  const [newDoc, change] = Frontend.change(doc, message, callback)
  return newDoc
}

function emptyChange (doc: Doc, message: string) {
  const [newDoc, change] = Frontend.emptyChange(doc, message)
  return newDoc
}

function undo (doc: Doc, message: string) {
  const [newDoc, change] = Frontend.undo(doc, message)
  return newDoc
}

function redo (doc: Doc, message: string) {
  const [newDoc, change] = Frontend.redo(doc, message)
  return newDoc
}

function load (str: string, actorId: Actor) {
  return docFromChanges(actorId || uuid(), transit.fromJSON(str))
}

function save (doc: Doc) {
  const state = Frontend.getBackendState(doc)
  return transit.toJSON(state.getIn(['opSet', 'history']))
}

function merge (localDoc: Doc, remoteDoc: Doc) {
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  const localState = Frontend.getBackendState(localDoc)
  const remoteState = Frontend.getBackendState(remoteDoc)
  const [state, patch] = Backend.merge(localState, remoteState)
  if ((patch as any).diffs.length === 0) {
    return localDoc
  }
  (patch as any).state = state
  return Frontend.applyPatch(localDoc, patch)
}

function diff (oldDoc: Doc, newDoc: Doc) {
  const oldState = Frontend.getBackendState(oldDoc)
  const newState = Frontend.getBackendState(newDoc)
  const changes = Backend.getChanges(oldState, newState)
  const [state, patch] = Backend.applyChanges(oldState, changes)
  return (patch as any).diffs as Diff[]
}

function getChanges (oldDoc: Doc, newDoc: Doc) {
  const oldState = Frontend.getBackendState(oldDoc)
  const newState = Frontend.getBackendState(newDoc)
  return Backend.getChanges(oldState, newState)
}

function applyChanges (doc: Doc, changes: Change[]) {
  const oldState = Frontend.getBackendState(doc)
  const [newState, patch] = Backend.applyChanges(oldState, changes)
  ;(patch as any).state = newState
  return Frontend.applyPatch(doc, patch)
}

function getMissingDeps (doc: Doc) {
  return Backend.getMissingDeps(Frontend.getBackendState(doc))
}

function equals (val1: any, val2: any) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort()
  const keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function inspect (doc: Doc) {
  return JSON.parse(JSON.stringify(doc))
}

function getHistory (doc: Doc) {
  const state = Frontend.getBackendState(doc)
  const actor = Frontend.getActorId(doc)
  const history = state.getIn(['opSet', 'history'])
  return history.map((change: Change, index: number) => {
    return {
      get change () {
        return change.toJS()
      },
      get snapshot () {
        return docFromChanges(actor, history.slice(0, index + 1))
      }
    }
  }).toArray()
}

export {
  init, change, emptyChange, undo, redo,
  load, save, merge, diff, getChanges, applyChanges, getMissingDeps,
  equals, inspect, getHistory, uuid,
  Frontend, Backend
}

export { WatchableDoc } from './watchable_doc'
export { DocSet } from './doc_set'
export { Connection } from './connection'

export const canUndo = Frontend.canUndo
export const canRedo = Frontend.canRedo
export const getActorId = Frontend.getActorId
export const setActorId = Frontend.setActorId
export const getConflicts = Frontend.getConflicts
export const Text = Frontend.Text
export const Table = Frontend.Table
