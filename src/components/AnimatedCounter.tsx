import React from 'react';
import { animate } from 'motion/react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
}

export function AnimatedCounter({ value, duration = 1.0 }: AnimatedCounterProps) {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    const controls = animate(count, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (latest: number) => setCount(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value, duration]);

  return <>{count}</>;
}
