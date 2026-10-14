/** A client mistake or a known failure: the filter answers it with `status` and {success:false,message}. */
export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
