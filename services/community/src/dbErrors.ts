/**
 * Maps PostgreSQL errors caused by bad client input to a 4xx response, so they are not
 * reported (and masked) as server errors. Returns null for anything else.
 */
export function clientDbError(error: any): { status: number; message: string } | null {
  switch (error?.code) {
    case '23503': // foreign_key_violation: the referenced story/chapter does not exist
      return { status: 404, message: 'Truyện hoặc chương không tồn tại.' };
    case '22P02': // invalid_text_representation: e.g. a malformed UUID
    case '22001': // string_data_right_truncation: text longer than the column
    case '22003': // numeric_value_out_of_range
      return { status: 400, message: 'Dữ liệu không hợp lệ.' };
    case '23505': // unique_violation
      return { status: 409, message: 'Dữ liệu đã tồn tại.' };
    default:
      return null;
  }
}
