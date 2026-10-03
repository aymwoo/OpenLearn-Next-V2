import { describe, it, expect } from 'vitest';
import { escapeCSV } from '../csv';

describe('escapeCSV', () => {
  it('handles null and undefined', () => {
    expect(escapeCSV(null)).toBe('');
    expect(escapeCSV(undefined)).toBe('');
  });

  it('passes simple strings through unchanged', () => {
    expect(escapeCSV('hello')).toBe('hello');
    expect(escapeCSV('12345')).toBe('12345');
    expect(escapeCSV(123)).toBe('123');
  });

  it('escapes strings with commas, quotes, or newlines', () => {
    expect(escapeCSV('hello,world')).toBe('"hello,world"');
    expect(escapeCSV('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
  });
});
