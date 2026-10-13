import { describe, it, expect, beforeEach } from 'vitest';
import { FlaskConical } from 'lucide-react';
import {
  SEGMENT_TYPES,
  registerCustomSegmentType,
  unregisterCustomSegmentType,
  unregisterPluginSegmentTypes,
  getAllSegmentTypes,
  getSegmentType,
  resolveSegmentIcon,
} from '../timelineConfig';

describe('segment type registry (plugin ownership + icon resolve)', () => {
  beforeEach(() => {
    unregisterPluginSegmentTypes('plugin-a');
    unregisterPluginSegmentTypes('plugin-b');
    unregisterCustomSegmentType('scientific_experiment');
    unregisterCustomSegmentType('group_debate');
  });

  it('resolveSegmentIcon accepts Lucide name strings', () => {
    expect(resolveSegmentIcon('FlaskConical')).toBe(FlaskConical);
    expect(resolveSegmentIcon('flask-conical')).toBe(FlaskConical);
    expect(resolveSegmentIcon(FlaskConical)).toBe(FlaskConical);
    expect(resolveSegmentIcon('not-a-real-icon')).toBeTruthy();
  });

  it('enforces plugin ownership on unregister', () => {
    registerCustomSegmentType(
      {
        id: 'scientific_experiment',
        labelZh: '科学探究实验',
        labelEn: 'Scientific Experiment',
        icon: FlaskConical,
      },
      'plugin-a',
    );

    unregisterCustomSegmentType('scientific_experiment', 'plugin-b');
    expect(getSegmentType('scientific_experiment').id).toBe('scientific_experiment');

    unregisterCustomSegmentType('scientific_experiment', 'plugin-a');
    expect(getSegmentType('scientific_experiment').id).toBe(SEGMENT_TYPES[1].id);
  });

  it('unregisterPluginSegmentTypes removes only that plugin types', () => {
    registerCustomSegmentType(
      {
        id: 'scientific_experiment',
        labelZh: '科学探究实验',
        labelEn: 'Scientific Experiment',
        icon: FlaskConical,
      },
      'plugin-a',
    );
    registerCustomSegmentType(
      {
        id: 'group_debate',
        labelZh: '随堂辩论',
        labelEn: 'Group Debate',
        icon: FlaskConical,
      },
      'plugin-b',
    );

    unregisterPluginSegmentTypes('plugin-a');
    expect(getAllSegmentTypes().map((t) => t.id)).toContain('group_debate');
    expect(getAllSegmentTypes().map((t) => t.id)).not.toContain('scientific_experiment');
  });
});
