/**
 * {{pluginName}} — Frontend component
 *
 * Renders inside the host application. Uses host shared dependencies.
 */
import React, { useState } from 'react';

export default function {{componentName}}() {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ padding: 16 }}>
      <h2>{{pluginName}}</h2>
      <p>{{description}}</p>
      <button onClick={() => setVisible(v => !v)}>
        {visible ? 'Hide' : 'Show'} Details
      </button>
      {visible && <p style={{ marginTop: 8 }}>Hello from {{pluginName}}!</p>}
    </div>
  );
}
