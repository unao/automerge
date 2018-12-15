declare module 'transit-immutable-js' {
  export const toJSON: <V = any>(v: V) => string
  export const fromJSON: <V = any>(s: string) => V
}
