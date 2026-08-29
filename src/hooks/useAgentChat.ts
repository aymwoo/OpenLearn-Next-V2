import React, { useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
}

export interface ChatAttachment {
  name: string;
  content: string;
}

export interface UseAgentChatOptions {
  lang: 'zh' | 'en';
  t: any;
  selectedLesson: string | null;
  effectiveAgentProviderId: string;
  expandedClassId: string | null;
  fetchLessons: () => Promise<void>;
  fetchClasses: () => Promise<void>;
  fetchStudents: () => Promise<void>;
  fetchClassStudents: (classId: string) => Promise<void>;
  fetchClassProgress: (classId: string) => Promise<void>;
  fetchClassDashboard: (classId: string) => Promise<void>;
  fetchElements: (lessonId: string) => Promise<void>;
}

export function useAgentChat(options: UseAgentChatOptions) {
  const {
    lang,
    t,
    selectedLesson,
    effectiveAgentProviderId,
    expandedClassId,
    fetchLessons,
    fetchClasses,
    fetchStudents,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchElements,
  } = options;

  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);

  const handleChatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((file: any) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setChatAttachments((prev) => [
            ...prev,
            { name: file.name, content: event.target!.result as string },
          ]);
        }
      };
      if (file.name.endsWith('.zip')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const handleChatDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    Array.from(e.dataTransfer.files).forEach((file: any) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setChatAttachments((prev) => [
            ...prev,
            { name: file.name, content: event.target!.result as string },
          ]);
        }
      };
      if (file.name.endsWith('.zip')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const attachmentsToSend = [...chatAttachments];
    let displayMessage = input;
    if (attachmentsToSend.length > 0) {
      displayMessage += `\n(📁 ${lang === 'zh' ? '附件' : 'Attachments'}: ${attachmentsToSend.map((f) => f.name).join(', ')})`;
    }

    setChatLog((prev) => [...prev, { role: 'user', content: displayMessage }]);
    setInput('');
    setChatAttachments([]);
    setLoading(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          lang,
          currentLessonId: selectedLesson,
          attachments: attachmentsToSend,
          providerId:
            effectiveAgentProviderId === 'system'
              ? null
              : effectiveAgentProviderId,
        }),
      });
      const data = await res.json();

      let replyContent = '';
      if (!res.ok || data.success === false) {
        replyContent = `⚠️ [System Error] ${data.error || (lang === 'zh' ? '未知系统错误' : 'Unknown System Error')}`;
      } else {
        replyContent = data.agentText || '';
        if (data.toolResults && data.toolResults.length > 0) {
          replyContent +=
            `\n\n${t.executedCommands}` +
            data.toolResults.map((r: any) => r.callName).join(', ');
        }
      }

      setChatLog((prev) => [...prev, { role: 'agent', content: replyContent }]);

      // Refresh state
      await fetchLessons();
      await fetchClasses();
      await fetchStudents();
      if (expandedClassId) {
        await fetchClassStudents(expandedClassId);
        await fetchClassProgress(expandedClassId);
        await fetchClassDashboard(expandedClassId);
      }
      if (selectedLesson) await fetchElements(selectedLesson);
    } catch {
      setChatLog((prev) => [
        ...prev,
        { role: 'agent', content: t.simulationError },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAgentMemory = () => {
    setChatLog([]);
  };

  return {
    chatLog,
    setChatLog,
    input,
    setInput,
    loading,
    setLoading,
    chatAttachments,
    setChatAttachments,
    handleChatFileChange,
    handleChatDrop,
    handleSend,
    handleClearAgentMemory,
  };
}
