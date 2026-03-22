// sample-stateful.ts — Stateful module for testing reloadFresh().
// Has mutable module-level state that carries over between calls.

let counter = 0;

export function increment(): number {
  return ++counter;
}

export function getCount(): number {
  return counter;
}
