// exceljs stub for vitest — provides a no-op workbook so tests don't fail on optional import
export class Workbook {
  addWorksheet() {
    return { addRow: () => ({}), getColumn: () => ({ width: 10 }) };
  }
  xlsx = {
    write: () => Promise.resolve(Buffer.from('mock excel content')),
    writeBuffer: () => Promise.resolve(Buffer.from('mock excel content')),
  };
}
export default { Workbook };
