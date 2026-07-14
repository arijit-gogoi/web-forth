import { expect, test } from 'vitest'
import { ENGINE } from './index'

test('engine scaffold smoke', () => {
  expect(ENGINE).toBe('@web-forth/engine')
  expect(1 + 1).toBe(2)
})
