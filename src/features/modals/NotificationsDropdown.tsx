import React from 'react';
import { ClipboardList, Sparkles, CheckCircle2 } from 'lucide-react';

interface NotificationsDropdownProps {
  isOpen: boolean;
  lang: string;
  activeStudentId: string | null;
  studentNotifications: any[];
  readNotifications: Set<string>;
  setReadNotifications: (s: Set<string>) => void;
  studentDashboardData: any;
  setIsNotificationsOpen: (v: boolean) => void;
  setSelectedNotificationForModal: (n: any) => void;
}

export function NotificationsDropdown({
  isOpen, lang, activeStudentId, studentNotifications, readNotifications,
  setReadNotifications, studentDashboardData, setIsNotificationsOpen,
  setSelectedNotificationForModal,
}: NotificationsDropdownProps) {
  if (!isOpen) return null;
  const unread = studentNotifications.filter((n: any) => !readNotifications.has(n.id));

  return (
    <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 shadow-lg rounded-xl z-50 overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <h3 className="font-semibold text-gray-800">Notifications</h3>
        {unread.length > 0 && (
          <button
            onClick={async () => {
              if (!activeStudentId) return;
              try {
                const promises = studentNotifications
                  .filter((n: any) => !readNotifications.has(n.id))
                  .map((n: any) => fetch(`/api/students/${activeStudentId}/read_notifications`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notificationId: n.id }),
                  }));
                await Promise.all(promises);
              } catch (e) { console.error(e); }
              const newRead = new Set(readNotifications);
              studentNotifications.forEach((n: any) => newRead.add(n.id));
              setReadNotifications(newRead);
            }}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Mark all as read
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {studentNotifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500 italic">No notifications.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {studentNotifications.map((notif: any) => {
              const isUnread = !readNotifications.has(notif.id);
              return (
                <div
                  key={notif.id}
                  className={`p-3 hover:bg-gray-50 cursor-pointer ${isUnread ? 'bg-indigo-50/30' : ''}`}
                  onClick={() => {
                    if (isUnread) {
                      if (activeStudentId) {
                        fetch(`/api/students/${activeStudentId}/read_notifications`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ notificationId: notif.id }),
                        }).catch(console.error);
                      }
                      const newRead = new Set(readNotifications);
                      newRead.add(notif.id);
                      setReadNotifications(newRead);
                    }
                    const assoc = studentDashboardData?.assignments?.find((a: any) => a.id === notif.relatedId);
                    setSelectedNotificationForModal({ ...notif, assignment: assoc });
                    setIsNotificationsOpen(false);
                  }}
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      {notif.type === 'new_assignment' ? (
                        <ClipboardList size={16} className="text-indigo-500" />
                      ) : notif.type === 'rollcall_picked' ? (
                        <Sparkles size={16} className="text-amber-500 animate-pulse" />
                      ) : (
                        <CheckCircle2 size={16} className="text-green-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{notif.title}</div>
                      <div className={`text-xs mt-0.5 ${isUnread ? 'text-gray-600' : 'text-gray-500'}`}>{notif.message}</div>
                    </div>
                    {isUnread && <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1"></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
