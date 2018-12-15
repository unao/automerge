import { Set } from 'immutable'
import * as Frontend from './frontend'
import * as Backend from './backend'

import { Doc, Change } from './types'

type Handler = (d: Doc) => void

export class WatchableDoc {
  handlers = Set<Handler>()

  constructor (private doc: Doc) {
    if (!doc) throw new Error('doc argument is required')
  }

  get () {
    return this.doc
  }

  set (doc: Doc) {
    this.doc = doc
    this.handlers.forEach(handler => handler!(doc)) // FIXME: ! should not be necessary
  }

  applyChanges (changes: Change[]) {
    const oldState = Frontend.getBackendState(this.doc)
    const [newState, patch] = Backend.applyChanges(oldState, changes)
    ;(patch as any).state = newState
    const newDoc = Frontend.applyPatch(this.doc, patch)
    this.set(newDoc)
    return newDoc
  }

  registerHandler (handler: Handler) {
    this.handlers = this.handlers.add(handler)
  }

  unregisterHandler (handler: Handler) {
    this.handlers = this.handlers.remove(handler)
  }
}
