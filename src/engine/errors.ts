/** Thrown by applyAction for any action the rules do not allow. The input state is never modified. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

export function illegal(message: string): never {
  throw new IllegalActionError(message);
}
