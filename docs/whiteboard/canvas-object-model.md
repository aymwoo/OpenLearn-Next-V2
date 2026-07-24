# Canvas Object Model 画布对象模型

```typescript
export interface CanvasObject<T = any> {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  zIndex: number;
  locked: boolean;
  payload: T;
}
```
