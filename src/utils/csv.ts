/**
 * Utility functions for CSV handling and formatting
 */

/**
 * Escapes a cell value for safe inclusion in a CSV format according to RFC 4180.
 *
 * @param val The raw cell value
 * @returns Escaped CSV string representation
 */
export function escapeCSV(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const stringified = String(val);
  if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}
