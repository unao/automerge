import { Map } from 'immutable'

import { KeyOrNull, Value, Count, Level, Distance, IteratorMode } from './types'

// Returns a random number from the geometric distribution with p = 0.75.
// That is, returns k with probability p * (1 - p)^(k - 1).
// For example, returns 1 with probability 3/4, returns 2 with probability 3/16,
// returns 3 with probability 3/64, and so on.
function randomLevel () {
  // NOTE: this function used to be a generator; it has been converted to a regular
  // function (that mimics the interface of a generator) to avoid having to include
  // generator polyfills in the distribution build.
  return {
    next () {
      // Create random number between 0 and 2^32 - 1
      const rand = Math.floor(Math.random() * 0x100000000)
      // Count leading zeros in that 32-bit number
      let level = 1
      while (rand < 1 << (32 - 2 * level) && level < 16) level += 1
      return { value: level, done: false }
    }
  }
}

class Node<V = Value> {
  constructor (readonly key: KeyOrNull, readonly value: V, readonly level: Level,
    readonly prevKey: ReadonlyArray<KeyOrNull>, readonly nextKey: ReadonlyArray<KeyOrNull>,
    readonly prevCount: ReadonlyArray<Count>, readonly nextCount: ReadonlyArray<Count>) {
    this.key = key
    this.value = value
    this.level = level
    this.prevKey = Object.freeze(prevKey)
    this.nextKey = Object.freeze(nextKey)
    this.prevCount = Object.freeze(prevCount)
    this.nextCount = Object.freeze(nextCount)
    Object.freeze(this)
  }

  setValue (key: KeyOrNull, value: V) {
    return new Node(this.key, value, this.level, this.prevKey, this.nextKey,
      this.prevCount, this.nextCount)
  }

  insertAfter (newKey: KeyOrNull, newLevel: Level, fromLevel: Level, distance: Distance) {
    if (newLevel > this.level && this.key !== null) {
      throw new RangeError('Cannot increase the level of a non-head node')
    }
    const maxLevel = Math.max(this.level, newLevel)
    const nextKey = this.nextKey.slice()
    const nextCount = this.nextCount.slice()

    for (let level = fromLevel; level < maxLevel; level++) {
      if (level < newLevel) {
        nextKey[level] = newKey
        nextCount[level] = distance
      } else {
        nextCount[level] += 1
      }
    }

    return new Node(this.key, this.value, maxLevel,
      this.prevKey, nextKey, this.prevCount, nextCount)
  }

  insertBefore (newKey: KeyOrNull, newLevel: Level, fromLevel: Level, distance: Distance) {
    if (newLevel > this.level) throw new RangeError('Cannot increase node level')
    const prevKey = this.prevKey.slice()
    const prevCount = this.prevCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < newLevel) {
        prevKey[level] = newKey
        prevCount[level] = distance
      } else {
        prevCount[level] += 1
      }
    }

    return new Node(this.key, this.value, this.level,
      prevKey, this.nextKey, prevCount, this.nextCount)
  }

  removeAfter (fromLevel: Level, removedLevel: Level, newKeys: KeyOrNull[], distances: Distance[]) {
    const nextKey = this.nextKey.slice()
    const nextCount = this.nextCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < removedLevel) {
        nextKey[level] = newKeys[level]
        nextCount[level] = distances[level]
      } else {
        nextCount[level] -= 1
      }
    }

    return new Node(this.key, this.value, this.level,
      this.prevKey, nextKey, this.prevCount, nextCount)
  }

  removeBefore (fromLevel: Level, removedLevel: Level, newKeys: KeyOrNull[], distances: Distance[]) {
    const prevKey = this.prevKey.slice()
    const prevCount = this.prevCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < removedLevel) {
        prevKey[level] = newKeys[level]
        prevCount[level] = distances[level]
      } else {
        prevCount[level] -= 1
      }
    }

    return new Node(this.key, this.value, this.level,
      prevKey, this.nextKey, prevCount, this.nextCount)
  }
}

export class SkipList {
  public length!: number
  private _nodes!: Map<any, Node>
  private _randomSource!: ReturnType<typeof randomLevel>

  constructor (randomSource?: typeof randomLevel) {
    const head = new Node(null, null, 1, [], [null], [], [null])
    const random = randomSource ? randomSource() : randomLevel()
    return makeInstance(0, Map<any, Node>().set(null as any, head), random)
  }

  get headNode () {
    return this._nodes.get(null)
  }

  predecessors (predecessor: KeyOrNull, maxLevel: Level) {
    const preKeys: KeyOrNull[] = [predecessor]
    const preCounts: Count[] = [1]

    for (let level = 1; level < maxLevel; level++) {
      let preKey = preKeys[level - 1]
      let count = preCounts[level - 1]
      while (preKey) {
        let node = this._nodes.get(preKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + preKey + ' below expected level ' + (level - 1))
        }
        count += node.prevCount[level - 1]
        preKey = node.prevKey[level - 1]
      }
      preKeys[level] = preKey
      preCounts[level] = count
    }

    return { preKeys, preCounts }
  }

  successors (successor: KeyOrNull, maxLevel: Level) {
    const sucKeys: KeyOrNull[] = [successor]
    const sucCounts: Count[] = [1]

    for (let level = 1; level < maxLevel; level++) {
      let sucKey = sucKeys[level - 1]
      let count = sucCounts[level - 1]
      while (sucKey) {
        let node = this._nodes.get(sucKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + sucKey + ' below expected level ' + (level - 1))
        }
        count += node.nextCount[level - 1]
        sucKey = node.nextKey[level - 1]
      }
      sucKeys[level] = sucKey
      sucCounts[level] = count
    }

    return { sucKeys, sucCounts }
  }

  // Inserts a new list element immediately after the element with key `predecessor`.
  // If predecessor === null, inserts at the head of the list.
  insertAfter (predecessor: KeyOrNull, key: KeyOrNull, value: Value) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    if (!this._nodes.has(predecessor)) {
      throw new RangeError('The referenced predecessor key does not exist')
    }
    if (this._nodes.has(key)) {
      throw new RangeError('Cannot insert a key that already exists')
    }

    const newLevel = this._randomSource.next().value
    const maxLevel = Math.max(newLevel, this.headNode.level)
    const successor = this._nodes.get(predecessor).nextKey[0] || null
    const { preKeys, preCounts } = this.predecessors(predecessor, maxLevel)
    const { sucKeys, sucCounts } = this.successors(successor, maxLevel)

    return makeInstance(this.length + 1, this._nodes.withMutations(nodes => {
      let preLevel: Level = 0
      let sucLevel: Level = 0
      for (let level: Level = 1; level <= maxLevel; level++) {
        const updateLevel = Math.min(level, newLevel)
        if (level === maxLevel || preKeys[level] !== preKeys[preLevel]) {
          nodes.update(preKeys[preLevel],
            node => node.insertAfter(key, updateLevel, preLevel, preCounts[preLevel]))
          preLevel = level
        }
        if (sucKeys[sucLevel] && (level === maxLevel || sucKeys[level] !== sucKeys[sucLevel])) {
          nodes.update(sucKeys[sucLevel],
            node => node.insertBefore(key, updateLevel, sucLevel, sucCounts[sucLevel]))
          sucLevel = level
        }
      }

      nodes.set(key, new Node(key, value, newLevel,
        preKeys.slice(0, newLevel),
        sucKeys.slice(0, newLevel),
        preCounts.slice(0, newLevel),
        sucCounts.slice(0, newLevel)))
    }), this._randomSource)
  }

  insertIndex (index: number, key: KeyOrNull, value: Value) {
    if (typeof index !== 'number' || index < 0) {
      throw new RangeError('Index must be a non-negative integer')
    }
    if (index === 0) {
      return this.insertAfter(null, key, value)
    } else {
      return this.insertAfter(this.keyOf(index - 1), key, value)
    }
  }

  removeKey (key: KeyOrNull) {
    if (typeof key !== 'string' || !this._nodes.has(key)) {
      throw new RangeError('The given key cannot be removed because it does not exist')
    }
    const removedNode = this._nodes.get(key)
    const maxLevel = this.headNode.level
    const { preKeys, preCounts } = this.predecessors(removedNode.prevKey[0], maxLevel)
    const { sucKeys, sucCounts } = this.successors(removedNode.nextKey[0], maxLevel)
    const distances = new Array(maxLevel)

    for (let level = 0; level < maxLevel; level++) {
      distances[level] = preCounts[level] + sucCounts[level] - 1
    }

    return makeInstance(this.length - 1, this._nodes.withMutations(nodes => {
      nodes.remove(key)
      let preLevel: Level = 0
      let sucLevel: Level = 0

      for (let level: Level = 1; level <= maxLevel; level++) {
        const updateLevel = Math.min(level, removedNode.level)
        if (level === maxLevel || preKeys[level] !== preKeys[preLevel]) {
          nodes.update(preKeys[preLevel],
            node => node.removeAfter(preLevel, updateLevel, sucKeys, distances))
          preLevel = level
        }
        if (sucKeys[sucLevel] && (level === maxLevel || sucKeys[level] !== sucKeys[sucLevel])) {
          nodes.update(sucKeys[sucLevel],
            node => node.removeBefore(sucLevel, updateLevel, preKeys, distances))
          sucLevel = level
        }
      }
    }), this._randomSource)
  }

  removeIndex (index: number) {
    return this.removeKey(this.keyOf(index))
  }

  indexOf (key: KeyOrNull) {
    if (typeof key !== 'string' || key === '' || !this._nodes.has(key)) return -1
    let node = this._nodes.get(key)
    let count: Count = 0
    while (node && node.key) {
      count += node.prevCount[node.level - 1]
      node = this._nodes.get(node.prevKey[node.level - 1])
    }
    return count - 1
  }

  keyOf (index: number) {
    if (typeof index !== 'number') return null
    if (index < 0) index = index + this.length
    if (index < 0 || index >= this.length) return null

    let node = this._nodes.get(null)
    let level: Level = node.level - 1
    let count: Count = 0
    while (true) {
      if (count === index + 1) {
        return node.key
      } else if (count + node.nextCount[level] > index + 1) {
        level -= 1
      } else {
        count += node.nextCount[level]
        node = this._nodes.get(node.nextKey[level])
      }
    }
  }

  getValue (key: KeyOrNull) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    const node = this._nodes.get(key)
    return node && node.value
  }

  setValue (key: KeyOrNull, value: Value) {
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('Key must be a nonempty string')
    }
    let node = this._nodes.get(key)
    if (!node) throw new RangeError('The referenced key does not exist')

    node = node.setValue(key, value)
    return makeInstance(this.length, this._nodes.set(key, node), this._randomSource)
  }

  iterator (mode: IteratorMode) {
    // NOTE: this method used to be a generator; it has been converted to a regular
    // method (that mimics the interface of a generator) to avoid having to include
    // generator polyfills in the distribution build.
    const nodes = this._nodes
    let key = nodes.get(null).nextKey[0]
    return {
      next () {
        if (!key) return { value: undefined, done: true }
        const node = nodes.get(key)
        let rval = undefined
        switch (mode) {
          case 'keys': rval = { value: key, done: false }; break
          case 'values': rval = { value: node.value, done: false }; break
          case 'entries': rval = { value: [key, node.value], done: false }; break
        }
        key = node.nextKey[0]
        return rval
      },
      [Symbol.iterator]: () => this.iterator(mode)
    }
  }

  [Symbol.iterator] () {
    return this.iterator('values')
  }
}

function makeInstance (length: number, nodes: Map<any, Node>, randomSource: ReturnType<typeof randomLevel>) {
  const instance = Object.create(SkipList.prototype)
  instance.length = length
  instance._nodes = nodes
  instance._randomSource = randomSource
  return Object.freeze(instance)
}
