import { createFixtureDirectory, retainFixture } from './fixtureRuntime.mjs'

const [action, value] = process.argv.slice(2)
if (process.argv.length !== 4 || !value) throw new Error('Expected create <prefix> or retain <absolute fixture path>')
if (action === 'create') console.log(createFixtureDirectory(value))
else if (action === 'retain') retainFixture(value)
else throw new Error('Unknown fixture action')
