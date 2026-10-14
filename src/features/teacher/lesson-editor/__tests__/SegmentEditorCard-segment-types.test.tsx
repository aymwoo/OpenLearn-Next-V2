import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlaskConical } from 'lucide-react';
import { SegmentEditorCard } from '../SegmentEditorCard';
import {
  registerCustomSegmentType,
  unregisterCustomSegmentType,
} from '../timelineConfig';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';

describe('SegmentEditorCard custom segment types', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    host = new FrontendPluginHost();
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });
    unregisterCustomSegmentType('scientific_experiment');
  });

  afterEach(() => {
    unregisterCustomSegmentType('scientific_experiment');
    cleanup();
  });

  it('includes plugin-registered segment types in the type <select>', () => {
    registerCustomSegmentType({
      id: 'scientific_experiment',
      labelZh: '科学探究实验',
      labelEn: 'Scientific Experiment',
      icon: FlaskConical,
    });

    render(
      <PluginHostProvider host={host}>
        <SegmentEditorCard
          lang="zh"
          segment={{ id: 'seg1', title: '实验', type: 'lecture', duration: '10m', notes: '' }}
          onPatch={() => {}}
          onDelete={() => {}}
        />
      </PluginHostProvider>,
    );

    const option = screen.getByRole('option', { name: '科学探究实验' }) as HTMLOptionElement;
    expect(option).toBeTruthy();
    expect(option.value).toBe('scientific_experiment');
  });
});
