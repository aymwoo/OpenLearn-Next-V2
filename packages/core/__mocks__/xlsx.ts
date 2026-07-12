// xlsx stub for vitest — provides a no-op read/write so tests don't fail on optional import
export function read() { return []; }
export function write() { return Buffer.from("mock excel content"); }
export const utils = {
  book_new: () => ({}),
  json_to_sheet: () => ({}),
  book_append_sheet: () => ({}),
};
export default { read, write, utils };
