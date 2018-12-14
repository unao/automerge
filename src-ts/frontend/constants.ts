// Properties of the document root object
export const OPTIONS = Symbol('_options')   // object containing options passed to init()
export const CACHE = Symbol('_cache')     // map from objectId to immutable object
export const INBOUND = Symbol('_inbound')   // map from child objectId to parent objectId
export const STATE = Symbol('_state')     // object containing metadata about current state (e.g. sequence numbers)

// Properties of all Automerge objects
export const OBJECT_ID = '_objectId'          // the object ID of the current object (string)
export const CONFLICTS = '_conflicts'         // map or list (depending on object type) of conflicts
export const CHANGE = Symbol('_change')    // the context object on proxy objects used in change callback

// Properties of Automerge list objects
export const ELEM_IDS = Symbol('_elemIds')   // list containing the element ID of each list element
export const MAX_ELEM = Symbol('_maxElem')   // maximum element counter value in this list (number)
