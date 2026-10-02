/**
 * useToast — 全局 Toast 快捷封装（C1-R2b）。
 *
 * toasts 数据本体存于 uiStore（经 appStore 镜像），此处仅提供 addToast 快捷函数。
 * 原 App.tsx 内联实现原样迁入，行为不变。
 */
import { useCallback } from 'react';
import { appStore } from '../store/appStore';
import type { Toast } from '../types/app';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export function useToast() {
  const addToast = useCallback((title: string, message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    appStore.getState().addToast({ id, title, message, type });
    setTimeout(() => {
      appStore.getState().removeToast(id);
    }, 6000);
  }, []);

  return { addToast };
}

export type AddToast = (title: string, message: string, type?: ToastType) => void;
export type { Toast };
