import { Map, Set } from 'immutable'
import * as Frontend from './frontend'
import * as Backend from './backend'

import { Doc, ObjectId, Change } from './types'

type Handler = (id: ObjectId, doc: Doc) => void

export class DocSet {
  docs = Map<ObjectId, Doc>()
  handlers = Set<Handler>()

  get docIds () {
    return this.docs.keys()
  }

  getDoc (docId: ObjectId) {
    return this.docs.get(docId)
  }

  setDoc (docId: ObjectId, doc: Doc) {
    this.docs = this.docs.set(docId, doc)
    this.handlers.forEach(handler => handler!(docId, doc))
  }

  applyChanges (docId: ObjectId, changes: Change[]) {
    let doc = this.docs.get(docId) || Frontend.init({ backend: Backend })
    const oldState = Frontend.getBackendState(doc)
    const [newState, patch] = Backend.applyChanges(oldState, changes)
    ;(patch as any).state = newState
    doc = Frontend.applyPatch(doc, patch)
    this.setDoc(docId, doc)
    return doc
  }

  registerHandler (handler: Handler) {
    this.handlers = this.handlers.add(handler)
  }

  unregisterHandler (handler: Handler) {
    this.handlers = this.handlers.remove(handler)
  }
}
