import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('LoginPage autofill attributes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sets username and current-password autocomplete attributes on teacher sign-in form', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);

    const usernameInput = screen.getByLabelText(/Staff Username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Access Password/i) as HTMLInputElement;

    expect(usernameInput.getAttribute('autocomplete')).toBe('username');
    expect(usernameInput.getAttribute('spellcheck')).toBe('false');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
    expect(passwordInput.type).toBe('password');
  });

  it('sets username and current-password autocomplete attributes on student sign-in form', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Student Self-Service/i }));

    const accessKeyInput = screen.getByLabelText(/Student Access Key/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Personal Password/i) as HTMLInputElement;

    expect(accessKeyInput.getAttribute('autocomplete')).toBe('username');
    expect(accessKeyInput.getAttribute('spellcheck')).toBe('false');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
    expect(passwordInput.type).toBe('password');
  });
});
