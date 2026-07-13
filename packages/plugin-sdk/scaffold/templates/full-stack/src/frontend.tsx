/**
 * {{pluginName}} — Frontend entry point
 *
 * This component is rendered inside the host application when the classroom tool
 * is activated. Host shared dependencies (react, react-dom, recharts, lucide-react)
 * are provided via window.HostSharedDeps — do not bundle them.
 */
import React, { useState } from 'react';

export default function {{componentName}}() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 16 }}>
      <h2>{{pluginName}}</h2>
      <p>{{description}}</p>
      <p>Counter: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  );
}
