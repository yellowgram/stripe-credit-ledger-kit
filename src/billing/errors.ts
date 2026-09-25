/**
 * MIT extract — see src/billing/LICENSE.MIT. The rest of the repo is not MIT.
 */
export class LedgerError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "LedgerError";
    this.code = code;
  }
}
