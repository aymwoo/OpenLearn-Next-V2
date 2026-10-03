import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Award } from 'lucide-react';
import { PluginIconRenderer } from '../PluginIconRenderer';

afterEach(() => {
  cleanup();
});

describe('PluginIconRenderer', () => {
  it('renders default fallback Puzzle icon when no icon is provided', () => {
    const { container } = render(<PluginIconRenderer icon={null} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('lucide-puzzle')).toBe(true);
  });

  it('renders Lucide icon by PascalCase name', () => {
    const { container } = render(<PluginIconRenderer icon="BookOpen" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('lucide-book-open')).toBe(true);
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('renders Lucide icon by kebab-case name', () => {
    const { container } = render(<PluginIconRenderer icon="graduation-cap" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('lucide-graduation-cap')).toBe(true);
  });

  it('renders Emoji character in a span', () => {
    render(<PluginIconRenderer icon="📚" size={18} alt="Book" />);
    const emoji = screen.getByText('📚');
    expect(emoji).toBeTruthy();
    expect(emoji.tagName.toLowerCase()).toBe('span');
    expect(emoji.getAttribute('title')).toBe('Book');
  });

  it('renders image element when URL is passed', () => {
    render(<PluginIconRenderer icon="https://example.com/logo.svg" alt="Plugin Logo" size={20} />);
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/logo.svg');
    expect(img.getAttribute('alt')).toBe('Plugin Logo');
  });

  it('renders custom React component directly', () => {
    const { container } = render(<PluginIconRenderer icon={Award} size={18} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('lucide-award')).toBe(true);
  });

  it('falls back to Puzzle icon when icon string cannot be found', () => {
    const { container } = render(<PluginIconRenderer icon="NonExistentIconXYZ123" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('lucide-puzzle')).toBe(true);
  });
});
