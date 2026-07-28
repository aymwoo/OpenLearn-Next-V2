import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SystemResourceLibraryModal, type SystemResourceLibraryModalProps } from '../SystemResourceLibraryModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<SystemResourceLibraryModalProps> = {}): SystemResourceLibraryModalProps {
  return {
    isSystemResourceLibraryOpen: true,
    setIsSystemResourceLibraryOpen: vi.fn(),
    lang: 'en',
    systemResourceTab: 'system',
    setSystemResourceTab: vi.fn(),
    selectedLibraryResourceId: null,
    setSelectedLibraryResourceId: vi.fn(),
    vfsNodes: [],
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    cloudDrivePreviewNode: null,
    setCloudDrivePreviewNode: vi.fn(),
    loadingLibraryResources: false,
    libraryResources: [],
    fetchLibraryResources: vi.fn(),
    ...overrides,
  };
}

describe('SystemResourceLibraryModal', () => {
  it('renders the modal header when open (en)', () => {
    render(<SystemResourceLibraryModal {...makeProps({ lang: 'en', isSystemResourceLibraryOpen: true })} />);
    expect(screen.getByText('System Resource Library')).toBeTruthy();
  });

  it('renders the modal header when open (zh)', () => {
    render(<SystemResourceLibraryModal {...makeProps({ lang: 'zh', isSystemResourceLibraryOpen: true })} />);
    expect(screen.getByText('系统资源库与应用商城')).toBeTruthy();
  });

  it('does not render the modal when closed', () => {
    render(<SystemResourceLibraryModal {...makeProps({ isSystemResourceLibraryOpen: false })} />);
    expect(screen.queryByText('System Resource Library')).toBeNull();
    expect(screen.queryByText('系统资源库与应用商城')).toBeNull();
  });
});
