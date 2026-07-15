/**
 * 前端组件共享类型定义
 */

export interface FrontendCtx {
  invokeCommand: (type: string, payload?: any) => Promise<any>;
  ui?: {
    registerExtensionPoint: (slot: string, config: any) => void;
  };
}
