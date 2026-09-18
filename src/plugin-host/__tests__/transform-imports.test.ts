// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  transformBareModuleImports,
  transformNamedImports,
  transformImportClause,
  SHARED_MODULE_MAP,
} from '../plugin-host';

describe('transformBareModuleImports', () => {
  it('transforms combined default + named imports (e.g. React and hooks)', () => {
    const input = 'import React, { useState, useEffect } from "react";';
    const output = transformBareModuleImports(input);
    expect(output).toContain('const React = window.HostSharedDeps.React?.default ?? window.HostSharedDeps.React;');
    expect(output).toContain('const { useState, useEffect } = window.HostSharedDeps.React;');
  });

  it('transforms named imports with react-dom (e.g. createPortal)', () => {
    const input = 'import { createPortal } from "react-dom";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { createPortal } = window.HostSharedDeps.ReactDOM;');
  });

  it('transforms named imports with aliases using valid destructuring syntax', () => {
    const input = 'import { useState as useState2, useMemo as useMemo2 } from "react";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { useState: useState2, useMemo: useMemo2 } = window.HostSharedDeps.React;');
  });

  it('transforms namespace imports (e.g. * as LucideReact)', () => {
    const input = 'import * as LucideReact from "lucide-react";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const LucideReact = window.HostSharedDeps.LucideReact;');
  });

  it('transforms default imports (e.g. import React from "react")', () => {
    const input = "import React from 'react';";
    const output = transformBareModuleImports(input);
    expect(output).toBe('const React = window.HostSharedDeps.React?.default ?? window.HostSharedDeps.React;');
  });

  it('transforms combined default + namespace imports', () => {
    const input = 'import React, * as ReactAll from "react";';
    const output = transformBareModuleImports(input);
    expect(output).toContain('const React = window.HostSharedDeps.React?.default ?? window.HostSharedDeps.React;');
    expect(output).toContain('const ReactAll = window.HostSharedDeps.React;');
  });

  it('transforms side-effect imports into comments', () => {
    const input = 'import "react";';
    const output = transformBareModuleImports(input);
    expect(output).toContain('/* [HostSharedDeps] import "react"; */');
  });

  it('transforms react/jsx-runtime imports', () => {
    const input = 'import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { jsx: _jsx, jsxs: _jsxs } = window.HostSharedDeps.jsxRuntime;');
  });

  it('transforms recharts named imports', () => {
    const input = 'import { LineChart, Line, XAxis, YAxis } from "recharts";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { LineChart, Line, XAxis, YAxis } = window.HostSharedDeps.Recharts;');
  });

  it('transforms react-dom/client imports', () => {
    const input = 'import { createRoot } from "react-dom/client";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { createRoot } = (window.HostSharedDeps.ReactDOMClient || window.HostSharedDeps.ReactDOM);');
  });

  it('leaves non-shared local imports untouched', () => {
    const input = 'import { myHelper } from "./helpers.js";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('import { myHelper } from "./helpers.js";');
  });

  it('handles multiline imports with comments and whitespace', () => {
    const input = `import {
      /* React hook */
      useState,
      useEffect,
    } from "react";`;
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { useState, useEffect } = window.HostSharedDeps.React;');
  });

  it('handles type annotations in named imports', () => {
    const input = 'import { type ClassItem, useState } from "react";';
    const output = transformBareModuleImports(input);
    expect(output).toBe('const { ClassItem, useState } = window.HostSharedDeps.React;');
  });
});
