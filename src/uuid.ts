import uuid from 'uuid/v4'

let factory = uuid

function makeUuid () {
  return factory()
}

makeUuid.setFactory = (newFactory: typeof uuid) => factory = newFactory
makeUuid.reset = () => factory = uuid

export default makeUuid
