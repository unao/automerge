import { Map } from 'immutable'

export type Timestamp = number
export type PrimitiveValue = number | string | boolean | null

export interface ReferenceData { link: true, value: ObjectId }
export interface DateData { value: Timestamp, datatype: 'timestamp' }
export interface PrimitiveValueData { value: PrimitiveValue }

export type Data = ReferenceData | DateData | PrimitiveValueData

export type Key = string
export type Path = Key[] | null
export type KeyOrNull = string | null

export type Count = any

export type Value = any
export type Level = number
export type Distance = number

export type IteratorMode = 'keys' | 'values' | 'entries'
export type ListIteratorMode = IteratorMode | 'elems' | 'conflicts'

export type OpSet = Map<any, any>
export type Op = Map<any, any>
export type Change = Map<any, any>
export type Dep = any
export type Seq = number
export type Actor = string
export type ObjectId = string
export type ElementId = string
export type DataType = any
export type State = Map<any, any>
export type Ref = any
export type Inbound = any

export type Context = any

export type Clock = {}

export interface Conflict { actor: Actor, value: any, link?: boolean }

export type OpActionT = 'makeMap' | 'makeTable' | 'makeText' | 'makeList' | 'link'
export type ActionT = 'create' | 'insert' | 'set' | 'remove' | 'del' | 'ins' // TODO: figure difference between remove and del
export type ItemT = 'map' | 'table' | 'text' | 'list'

export interface Edit extends OpDataBase {
  key: Key, value: any, datatype: DataType, elemId: ElementId,
  link: boolean, index: number, path: Path, conflicts: Conflict[]
}

export interface Result {
  value: any
  datatype: DataType
}

export interface OpDataBase {
  action: ActionT, obj: ObjectId, type: ItemT, key?: Key
}

export interface DiffBase {
  conflicts: Conflict[]
}

export type Diff = Partial<DiffBase> & Partial<Data> & OpDataBase

export type ListDiff = Diff & { index: number, elemId: ElementId }

// TODO Figure-out and clean up
export type OpRaw = { action: OpActionT, obj: ObjectId }
  | ({ action: ActionT, obj: ObjectId, key: Key, elem?: number } & Data)
  | ({ action: ActionT, obj: ObjectId, key: Key, index?: number }) // TODO: Improve typing - split actions into groups

export type Doc = any
export type RequestT = 'change' | 'undo' | 'redo'
export type Request = any
export type Patch = any
export type StateRaw = any
export type InitOptions = any
