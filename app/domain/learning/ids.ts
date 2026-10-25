/**
 * Identifiers that would collide with `Object.prototype` when used as keys in
 * the persisted progress map. Catalog validation and repository validation must
 * agree on this list: a catalog that accepts an ID the repository rejects lets
 * the store create state it can never save.
 */
const RESERVED_IDS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

export function isReservedId(value: string): boolean {
  return RESERVED_IDS.has(value)
}
