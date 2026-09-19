import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FontSizeSelector } from '../FontSizeSelector';
import { useFontSizeStore, FONT_SCALE_DEFAULT } from '../../store/fontSizeStore';

describe('FontSizeSelector Component', () => {
  beforeEach(() => {
    localStorage.clear();
    useFontSizeStore.setState({
      scale: FONT_SCALE_DEFAULT,
      minScale: 85,
      maxScale: 140,
      step: 5,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders trigger button', () => {
    render(<FontSizeSelector lang="zh" />);
    const button = screen.getByLabelText('Font size selector');
    expect(button).toBeTruthy();
    expect(button.getAttribute('title')).toContain('100%');
  });

  it('toggles dropdown popover on click', () => {
    render(<FontSizeSelector lang="zh" />);
    const button = screen.getByLabelText('Font size selector');

    // Initially closed
    expect(screen.queryByText('界面字号大小')).toBeNull();

    // Open
    fireEvent.click(button);
    expect(screen.getByText('界面字号大小')).toBeTruthy();
    expect(screen.getByText('常用档位')).toBeTruthy();

    // Close
    fireEvent.click(button);
    expect(screen.queryByText('界面字号大小')).toBeNull();
  });

  it('displays presets and allows selecting a preset', () => {
    render(<FontSizeSelector lang="zh" />);
    const button = screen.getByLabelText('Font size selector');
    fireEvent.click(button);

    // Click on 120% preset
    const preset120 = screen.getByText('大号 (120%)');
    fireEvent.click(preset120);

    expect(useFontSizeStore.getState().scale).toBe(120);
    // Button badge and stepper should show 120%
    expect(screen.getAllByText('120%').length).toBeGreaterThan(0);
  });

  it('handles steppers (A- and A+)', () => {
    render(<FontSizeSelector lang="zh" />);
    fireEvent.click(screen.getByLabelText('Font size selector'));

    const increaseBtn = screen.getByTitle('增大字体 (A+)');
    const decreaseBtn = screen.getByTitle('减小字体 (A-)');

    fireEvent.click(increaseBtn);
    expect(useFontSizeStore.getState().scale).toBe(105);

    fireEvent.click(decreaseBtn);
    expect(useFontSizeStore.getState().scale).toBe(100);
  });

  it('resets to 100% when clicking reset button', () => {
    useFontSizeStore.getState().setScale(130);
    render(<FontSizeSelector lang="zh" />);

    fireEvent.click(screen.getByLabelText('Font size selector'));
    const resetBtn = screen.getByTitle('恢复默认 100%');
    expect(resetBtn).toBeTruthy();

    fireEvent.click(resetBtn);
    expect(useFontSizeStore.getState().scale).toBe(100);
  });

  it('renders English labels when lang="en"', () => {
    render(<FontSizeSelector lang="en" />);
    fireEvent.click(screen.getByLabelText('Font size selector'));

    expect(screen.getByText('Interface Font Size')).toBeTruthy();
    expect(screen.getByText('Presets')).toBeTruthy();
    expect(screen.getByText('Large (120%)')).toBeTruthy();
  });
});
