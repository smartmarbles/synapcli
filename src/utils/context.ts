/**
 * Global runtime context.
 * Set once at startup via --ci flag and read throughout all commands.
 */

let _ci = false;

export function setCI(val: boolean): void {
  _ci = val;
}

export function isCI(): boolean {
  return _ci;
}
