import React from 'react';
import { AdminPanel } from '../../components/AdminPanel';
import { ShieldAlert } from 'lucide-react';
import type { SessionType } from '../../store/appStore';

interface AdminDirectoryViewProps {
  session: SessionType | null;
  lang: string;
  onLogout: () => void;
}

export function AdminDirectoryView({ session, lang, onLogout }: AdminDirectoryViewProps) {
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
    <AdminPanel currentUserId={session.userId || ''} currentUserRole={session.subRole} lang={lang} onLogout={onLogout} />
  );
}
