import { useEffect, useState } from 'react';
import { useOptionalAppData } from '../context/AppDataContext';
import { ExtensionPointRenderer } from '../plugin-host/extension-point-renderer';

/** 订阅浏览器网络在线状态（navigator.onLine + online/offline 事件） */
function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return isOnline;
}

/**
 * 全局底部状态栏 —— `statusbar.item` 扩展槽宿主。
 *
 * 平台本身不向状态栏放置内置条目：当没有任何插件贡献 `statusbar.item` 时，
 * 容器为空并通过 `empty:hidden` 隐藏，不占用布局空间（对无插件部署零视觉变化）。
 */
export function AppStatusBar() {
  const appData = useOptionalAppData();
  const isOnline = useOnlineStatus();

  const lang = (appData?.lang ?? 'zh') as 'zh' | 'en';
  const currentRole = (appData?.activeRole ?? 'teacher') as 'teacher' | 'student';
  const session = appData?.session;

  return (
    <footer
      id="app-statusbar"
      role="status"
      className="h-7 shrink-0 border-t border-theme bg-surface text-muted text-xs flex items-center justify-end gap-3 px-4 empty:hidden"
    >
      <ExtensionPointRenderer
        slot="statusbar.item"
        lang={lang}
        fallback={<></>}
        slotProps={{ session, currentRole, lang, isOnline }}
      />
    </footer>
  );
}
