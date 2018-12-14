export const ROOT_ID = '00000000-0000-0000-0000-000000000000'

export const isObject = (obj: any) => typeof obj === 'object' && obj !== null

/**
 * Returns true if all components of `clock1` are less than or equal to those
 * of `clock2` (both clocks given as Immutable.js Map objects). Returns false
 * if there is at least one component in which `clock1` is greater than
 * `clock2` (that is, either `clock1` is overall greater than `clock2`, or the
 * clocks are incomparable).
 */
export const lessOrEqual = (clock1: any, clock2: any) =>
  clock1.keySeq().concat(clock2.keySeq()).reduce(
    (result: boolean, key: any) => (result && clock1.get(key, 0) <= clock2.get(key, 0)),
    true)
