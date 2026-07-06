let counter = 0

/** Short unique id — stable enough for a local session, readable in JSON. */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`
}
