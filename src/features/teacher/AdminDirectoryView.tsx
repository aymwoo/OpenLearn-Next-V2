import React from 'react';
import { AdminPanel, type AIProvider, type SiteInfo } from '../../components/AdminPanel';
import { ShieldAlert } from 'lucide-react';
import type { SessionType } from '../../store/appStore';
import { useAppData } from '../../context/AppDataContext';

/**
 * C1-R3: 全部数据经 AppDataContext 取用，不再经 TeacherView props 透传。
 * （session/lang 由 useSessionBootstrap 与 store 提供，均在 context 中）
 */
export function AdminDirectoryView() {
  const { session, lang, onLogout, aiProviders, testingProviderId, onAIProvidersChanged, onTriggerTour, siteInfo, onSiteInfoChanged } =
    useAppData() as {
      session: SessionType | null;
      lang: string;
      onLogout: () => void;
      aiProviders: AIProvider[];
      testingProviderId: string | null;
      onAIProvidersChanged: () => void;
      onTriggerTour?: () => void;
      siteInfo?: SiteInfo;
      onSiteInfoChanged?: (info: SiteInfo) => void;
    };

  if (session?.subRole !== 'administrator') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-rose-500">
        <ShieldAlert size={48} className="mb-4" />
        <h2 className="text-xl font-bold">Access Denied / 拒绝访问</h2>
        <p className="text-sm text-gray-550 mt-1">Only system administrators are granted entry to this node.</p>
      </div>
    );
  }
  return (
    <AdminPanel
      currentUserId={session.userId || ''}
      currentUserRole={session.subRole}
      lang={lang as 'zh' | 'en'}
      onLogout={onLogout}
      aiProviders={aiProviders}
      testingProviderId={testingProviderId}
      onAIProvidersChanged={onAIProvidersChanged}
      onTriggerTour={onTriggerTour}
      siteInfo={siteInfo}
      onSiteInfoChanged={onSiteInfoChanged}
    />
  );
}
