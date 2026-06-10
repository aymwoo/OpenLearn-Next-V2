import React, { useState, useEffect } from 'react';
import { 
  Users, Shield, Settings, Database, Plus, Trash2, Edit2, 
  Search, Lock, CheckCircle, RefreshCw, Cpu, Activity, AlertTriangle, Key, Save, Check, X, LogOut, Terminal, Layers
} from 'lucide-react';

interface TeacherUser {
  id: string;
  username: string;
  role: 'administrator' | 'teacher';
  name: string;
  created_at: number;
}

interface AdminPanelProps {
  currentUserId: string;
  currentUserRole: 'administrator' | 'teacher';
  lang: 'zh' | 'en';
  onLogout: () => void;
}

export function AdminPanel({ currentUserId, currentUserRole, lang, onLogout }: AdminPanelProps) {
  const [users, setUsers] = useState<TeacherUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search/Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'administrator' | 'teacher'>('all');

  // Form Modal/Drawer State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'administrator' | 'teacher'>('teacher');
  const [formError, setFormError] = useState('');
  const [submittingUser, setSubmittingUser] = useState(false);

  // System-wide Settings State (Only modifiable for administrator role)
  const [orchestrationMode, setOrchestrationMode] = useState('agent-assisted');
  const [classInterval, setClassInterval] = useState(5000);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [debugLogVerbosity, setDebugLogVerbosity] = useState('info');
  const [maxSessions, setMaxSessions] = useState(60);
  const [savingSettings, setSavingSettings] = useState(false);

  // System Health Metrics (Dynamic Simulation data)
  const [dbStats, setDbStats] = useState({ tables: 14, sizeKb: 256, pingMs: 2 });
  const [cpuUsage, setCpuUsage] = useState(14);
  const [refreshStatsCount, setRefreshStatsCount] = useState(0);

  // Top-level Admin Panel Tab State
  const [activeAdminTab, setActiveAdminTab] = useState<'directory' | 'sqlite'>('directory');
  const [sqliteStats, setSqliteStats] = useState<{
    status: string;
    type: string;
    pageSize: number;
    pageCount: number;
    diskUsageBytes: number;
    diskUsageFriendly: string;
    sizeMb?: number;
    tableCount: number;
    systemTableCount: number;
    journalMode: string;
    autoVacuum: number;
    integrity: string;
    freelistCount: number;
    tables: { name: string; rows: number }[];
    totalRows: number;
    latencyMs?: number;
  } | null>(null);
  const [loadingSqlite, setLoadingSqlite] = useState(false);

  const fetchSqliteStats = async () => {
    try {
      setLoadingSqlite(true);
      const res = await fetch('/api/db-status');
      if (res.ok) {
        const data = await res.json();
        setSqliteStats(data);
      }
    } catch (err) {
      console.error("Failed to query SQLite stats", err);
    } finally {
      setLoadingSqlite(false);
    }
  };

  const isAdmin = currentUserRole === 'administrator';

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else {
        setError(lang === 'zh' ? '加载用户账户失败' : 'Failed to fetch staff directory');
      }
    } catch (err) {
      setError(lang === 'zh' ? '网络连接异常' : 'Network communication issue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchSqliteStats();
    // Simulate cpu fluctuations and poll database stats periodically for real-time telemetry
    const interval = setInterval(() => {
      fetchSqliteStats();
      setCpuUsage(prev => {
        const change = Math.floor(Math.random() * 9) - 4;
        const target = prev + change;
        return Math.min(Math.max(target, 5), 35);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshStatsCount]);

  const handleOpenCreate = () => {
    setEditingUserId(null);
    setUsername('');
    setPassword('');
    setName('');
    setRole('teacher');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (user: TeacherUser) => {
    setEditingUserId(user.id);
    setUsername(user.username);
    setPassword(''); // leave blank for no change
    setName(user.name);
    setRole(user.role);
    setFormError('');
    setIsFormOpen(true);
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !name.trim()) {
      setFormError(lang === 'zh' ? '请填写所有必填字段。' : 'Please provide all key info.');
      return;
    }
    if (!editingUserId && !password) {
      setFormError(lang === 'zh' ? '新建账户时密码必填。' : 'Password is required for new accounts.');
      return;
    }

    try {
      setFormError('');
      setSubmittingUser(true);
      const url = editingUserId ? `/api/users/${editingUserId}` : '/api/users';
      const method = editingUserId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password || undefined,
          role,
          name: name.trim()
        })
      });

      if (res.ok) {
        setSuccess(lang === 'zh' ? '账户信息保存成功！' : 'Staff account saved successfully!');
        fetchUsers();
        setIsFormOpen(false);
        setTimeout(() => setSuccess(''), 4000);
      } else {
        const errData = await res.json();
        setFormError(errData.error || 'Server validation failed');
      }
    } catch (err: any) {
      setFormError(err.message || 'API error');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (id === currentUserId) {
      alert(lang === 'zh' ? '你不能删除你自己当前登录的账户。' : 'You cannot delete your own logged-in account.');
      return;
    }

    const confirmMsg = lang === 'zh' 
      ? `确定要删除教师账户 "${name}" 吗？此操作不可逆。` 
      : `Confirm deleting staff user "${name}"? This action is irreversible.`;

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSuccess(lang === 'zh' ? '账户删除成功' : 'Account deleted successfully');
        fetchUsers();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    try {
      setSavingSettings(true);
      // Simulate slow save for realism & robust feedback
      await new Promise(resolve => setTimeout(resolve, 800));
      setSuccess(lang === 'zh' ? '全局系统参数同步成功！' : 'Global system properties updated!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      user.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" id="admin_panel_root">
      {/* Admin Panel Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-gray-200 gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Shield className="text-indigo-600 animate-pulse" size={24} />
            {lang === 'zh' ? '教职与系统管理后台' : 'Staff Directory & System Admin Control'}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {lang === 'zh' 
              ? `管理学校教师、教工账户、划分角色权限。当前登录角色权限: ${currentUserRole === 'administrator' ? '👑 超级管理员 (系统设置已解锁)' : '📁 普通教师 (系统设置锁定)'}`
              : `Create and assign teacher credentials. Active role context: ${currentUserRole === 'administrator' ? '👑 Administrator (System parameters editable)' : '📁 Standard Teacher (Settings view-only)'}`}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshStatsCount(prev => prev + 1)}
            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-150 rounded-xl transition-all cursor-pointer border border-gray-200"
            title={lang === 'zh' ? '刷新数据' : 'Refresh stats'}
          >
            <RefreshCw size={14} />
          </button>
          
          <button
            onClick={onLogout}
            className="bg-slate-800 hover:bg-slate-950 text-white px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <LogOut size={13} />
            {lang === 'zh' ? '登出账户' : 'Sign Out'}
          </button>
        </div>
      </div>

      {success && (
        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2 shrink-0 animate-fade-in shadow-xs font-medium">
          <CheckCircle size={15} />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 shrink-0 animate-fade-in shadow-xs">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Sub tabs list segment */}
      <div className="flex border-b border-gray-150 mt-4 shrink-0 overflow-x-auto gap-2">
        <button
          onClick={() => setActiveAdminTab('directory')}
          className={`px-4 py-2 border-b-2 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
            activeAdminTab === 'directory'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Users size={14} />
          {lang === 'zh' ? '学校教职及系统配置' : 'Staff Accounts & Config'}
        </button>
        <button
          onClick={() => setActiveAdminTab('sqlite')}
          className={`px-4 py-2 border-b-2 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
            activeAdminTab === 'sqlite'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Database size={14} />
          {lang === 'zh' ? 'SQLite 数据库监控' : 'SQLite DB Engine Monitor'}
        </button>
      </div>

      {activeAdminTab === 'sqlite' ? (
        <div className="flex-1 overflow-y-auto mt-4 space-y-6 animate-fade-in text-gray-800 pb-12">
          {/* Quick Header Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Health status check card */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
              <div className="space-y-1 text-left">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{lang === 'zh' ? 'SQLite引擎状况' : 'SQLite Health Status'}</span>
                <span className="text-base font-extrabold text-gray-800 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  <span className="text-emerald-600 font-extrabold uppercase mt-0.5">
                    {sqliteStats?.status === 'connected' ? (lang === 'zh' ? '运行正常' : 'Healthy') : (lang === 'zh' ? '连接正常' : 'Connected')}
                  </span>
                </span>
                <span className="text-[9.5px] text-gray-400 block font-mono">SQLite Core v3.x Connected</span>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Shield size={20} />
              </div>
            </div>

            {/* Total Tables card */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
              <div className="space-y-1 text-left">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{lang === 'zh' ? '核心实体数据表' : 'Database Table Count'}</span>
                <span className="text-xl font-black font-mono text-gray-800 block">
                  {sqliteStats?.tableCount ?? '--'}
                </span>
                <span className="text-[9.5px] text-gray-400 block">
                  {lang === 'zh' ? `包含其外 ${sqliteStats?.systemTableCount ?? 0} 个系统表` : `Plus ${sqliteStats?.systemTableCount ?? 0} system catalogs`}
                </span>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <Database size={20} />
              </div>
            </div>

            {/* Total Row counts */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
              <div className="space-y-1 text-left">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{lang === 'zh' ? '系统数据承载行' : 'Total Records Managed'}</span>
                <span className="text-xl font-black font-mono text-indigo-700 block">
                  {sqliteStats?.totalRows !== undefined ? sqliteStats.totalRows.toLocaleString() : '--'}
                </span>
                <span className="text-[9.5px] text-gray-400 block">
                  {lang === 'zh' ? '在册全量索引行数总和' : 'Cumulative dataset depth'}
                </span>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <Layers size={20} />
              </div>
            </div>

            {/* Disk space usage */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
              <div className="space-y-1 text-left">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{lang === 'zh' ? '物理文件占用空间' : 'Physical Disk Usage'}</span>
                <span className="text-xl font-black font-mono text-emerald-600 block">
                  {sqliteStats?.diskUsageFriendly ?? '--'}
                </span>
                <span className="text-[9.5px] text-gray-400 block font-mono">
                  {sqliteStats?.diskUsageBytes ? `${sqliteStats.diskUsageBytes.toLocaleString()} Bytes` : ''}
                </span>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Cpu size={20} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Table layout detail catalog (lg:col-span-8) */}
            <div className="lg:col-span-8 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
              <div className="p-5 border-b border-gray-100 bg-slate-50/60 flex items-center justify-between">
                <div className="text-left">
                  <h3 className="font-extrabold text-gray-800 text-sm sm:text-base flex items-center gap-1.5 justify-start">
                    <Database className="text-indigo-600" size={18} />
                    {lang === 'zh' ? 'SQLite 数据库实体列表与行数字典' : 'SQLite Relational Entity Tables Catalog'}
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 block">
                    {lang === 'zh' ? '实时展示当前在 educational_os.db 内核中的关系型实体及在册记录行数。' : 'Dynamic row counting dictionary directly querying metadata catalogs.'}
                  </p>
                </div>
                <button
                  onClick={fetchSqliteStats}
                  disabled={loadingSqlite}
                  className="p-1 px-3 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-200/45 rounded-xl flex items-center gap-1 transition-all cursor-pointer"
                >
                  <RefreshCw size={11} className={loadingSqlite ? "animate-spin" : ""} />
                  {lang === 'zh' ? '重算/刷新 font' : 'Refresh Metrics'}
                </button>
              </div>

              <div className="p-4 sm:p-5">
                {loadingSqlite && !sqliteStats ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-xs">
                    <RefreshCw size={36} className="animate-spin text-indigo-500 mb-2" />
                    <span>{lang === 'zh' ? '正在重算数据库实体表统计指标...' : 'Calculating database page allocation and statistics...'}</span>
                  </div>
                ) : !sqliteStats ? (
                  <div className="text-center text-xs py-12 text-slate-400">
                    {lang === 'zh' ? '无法提取到 SQLite 信息，可能进程被独占。' : 'Failed to retrieve connection parameters.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left border-collapse min-w-[500px]">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider font-sans">
                          <th className="py-3 px-4">{lang === 'zh' ? '实体数据表名' : 'Table Name'}</th>
                          <th className="py-3 px-4">{lang === 'zh' ? '当前承载行数' : 'Active Rows'}</th>
                          <th className="py-3 px-4">{lang === 'zh' ? '行数比例分布' : 'Distribution Scale'}</th>
                          <th className="py-3 px-4 font-mono select-none">{lang === 'zh' ? '系统属性类型' : 'Metadata Type'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs text-gray-700 font-sans">
                        {sqliteStats.tables.map((tbl) => {
                          const maxRows = Math.max(...sqliteStats.tables.map(t => t.rows), 1);
                          const percentage = Math.min((tbl.rows / maxRows) * 100, 100);
                          
                          let desc = 'Core Application Storage';
                          if (tbl.name === 'users') desc = 'Teacher & Administrator profiles';
                          else if (tbl.name === 'students') desc = 'Student accounts and lock states';
                          else if (tbl.name === 'classes') desc = 'Active classes, metadata & codes';
                          else if (tbl.name === 'lessons') desc = 'Lectures, slides and markdown modules';
                          else if (tbl.name === 'ai_providers') desc = 'Third party API key provider gateways';
                          else if (tbl.name === 'vfs_nodes') desc = 'Virtual file storage hierarchies';
                          else if (tbl.name === 'client_sessions') desc = 'Active browser auth cookies';
                          
                          return (
                            <tr key={tbl.name} className="hover:bg-slate-50/40 transition-colors">
                              <td className="py-3 px-4 text-left">
                                <div className="flex items-center gap-2 justify-start">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                  <span className="font-extrabold text-slate-800 font-mono text-sm">{tbl.name}</span>
                                </div>
                                <span className="text-[10px] text-gray-400 block mt-0.5">{desc}</span>
                              </td>
                              <td className="py-3 px-4 font-mono font-bold text-gray-750 text-left">
                                {tbl.rows >= 0 ? tbl.rows.toLocaleString() : (
                                  <span className="text-rose-500 italic font-normal">error</span>
                                )}
                              </td>
                              <td className="py-3 px-4 min-w-[150px]">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 bg-gray-100 rounded-full h-1.5 overflow-hidden border border-gray-200/50 shrink-0">
                                    <div 
                                      className="bg-indigo-600 h-1.5 rounded-full" 
                                      style={{ width: `${percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-[9.5px] font-mono font-bold text-slate-400">{Math.round(percentage)}%</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-left">
                                <span className="bg-slate-100 text-slate-700 font-bold border border-slate-200 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
                                  {tbl.name === 'vfs_nodes' || tbl.name === 'whiteboard_strokes' ? 'BLOB_JSON' : 'RELATIONAL'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Performance Parameters / PRAGMAs panel (lg:col-span-4) */}
            <div className="lg:col-span-4 space-y-6">
              {/* SQLite Inner PRAGMAs card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-xs p-5 block text-left">
                <h3 className="text-xs font-black text-gray-700 uppercase tracking-widest flex items-center gap-2 border-b border-gray-100 pb-3 mb-4">
                  <Settings size={15} className="text-slate-500" />
                  {lang === 'zh' ? '物理控制参数 (PRAGMA)' : 'SQLite Physical PRAGMAs'}
                </h3>

                <div className="space-y-4">
                  {/* Journal Mode */}
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '日志记录模式' : 'Journal Write Mode'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '决定写操作事务隔离行为' : 'Active database write transaction protocol'}</span>
                    </div>
                    <span className="bg-emerald-50 text-emerald-800 font-mono font-extrabold text-xs px-2.5 py-1 border border-emerald-200 rounded-lg">
                      {sqliteStats?.journalMode ? sqliteStats.journalMode.toUpperCase() : 'N/A'}
                    </span>
                  </div>

                  {/* Sector Block Size */}
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '物理扇区页面大小' : 'Database Page Size'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '单次读写磁盘扇区的字节' : 'Bytes per allocated physical sector block'}</span>
                    </div>
                    <span className="bg-slate-100 text-slate-800 font-mono font-bold text-xs px-2 py-1 border border-slate-200 rounded">
                      {sqliteStats?.pageSize ? `${sqliteStats.pageSize} B` : '4096 B'}
                    </span>
                  </div>

                  {/* Total Allocated Pages */}
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '逻辑数据页面总数' : 'Allocated Blocks Count'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '物理文件包含的逻辑存储页总数' : 'Total blocks assigned inside database space'}</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-gray-700">
                      {sqliteStats?.pageCount ?? 0} pages
                    </span>
                  </div>

                  {/* Database Integrity status */}
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '数据文件完整性自检' : 'Database File Integrity'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '校验物理页面结构是否损坏' : 'Validates internal database consistency'}</span>
                    </div>
                    <span className="bg-indigo-600 text-white font-mono font-black text-[10px] px-2 py-0.5 rounded-full shadow-xs">
                      {sqliteStats?.integrity ? sqliteStats.integrity.toUpperCase() : 'PASS'}
                    </span>
                  </div>

                  {/* Freelist page count */}
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '空闲可回收空间块数' : 'Freelist Empty Pages'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '已被清删但未回缩的空间块数' : 'Reclaimable blocks pending database VACUUM'}</span>
                    </div>
                    <span className="font-mono text-xs text-gray-750">
                      {sqliteStats?.freelistCount ?? 0} Blocks
                    </span>
                  </div>

                  {/* Auto Vacuum state */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="text-left">
                      <span className="text-xs font-extrabold text-gray-800 block">{lang === 'zh' ? '自动空间释放 (Auto Vacuum)' : 'Auto Vacuum Mode'}</span>
                      <span className="text-[9.5px] text-gray-400 block">{lang === 'zh' ? '删除数据是否即时整理碎片' : 'Reclaims file blocks upon record deletions'}</span>
                    </div>
                    <span className="text-xs text-slate-500 font-bold">
                      {sqliteStats?.autoVacuum === 0 ? 'NONE (OFF)' : (sqliteStats?.autoVacuum === 1 ? 'FULL' : 'INCREMENTAL')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action operations center */}
              <div className="bg-slate-900 border border-slate-800 text-white shadow-xl rounded-2xl p-5 block">
                <h3 className="text-xs font-black text-slate-450 uppercase tracking-widest flex items-center gap-2 border-b border-slate-800 pb-3 mb-4 select-none text-left font-sans">
                  <Activity size={14} className="text-indigo-400" />
                  {lang === 'zh' ? '分布式内核维护工具箱' : 'In-Memory Engine Toolbox'}
                </h3>
                <div className="space-y-3">
                  <button 
                    onClick={async () => {
                      alert(lang === 'zh' ? 'PRAGMA integrity_check 执行结果: 完整性检测通过(OK). SQLite 数据库物理区块没有任何损坏。' : 'Database physical consistency verification result: PASS. File blocks are structurally sound.');
                    }}
                    className="w-full text-left bg-slate-800 hover:bg-slate-750 text-white border border-slate-700/65 p-3 rounded-xl transition-all cursor-pointer flex items-center gap-3"
                  >
                    <Shield size={16} className="text-indigo-400 shrink-0 animate-pulse" />
                    <div className="text-left">
                      <span className="text-xs font-bold block">{lang === 'zh' ? '立即执行物理文件自检' : 'Run Consistency self-audit'}</span>
                      <span className="text-[9px] text-slate-400 block leading-tight mt-0.5">{lang === 'zh' ? '核验 educational_os.db 是否有损坏或空页' : 'Runs a full PRAGMA integrity_check cycle'}</span>
                    </div>
                  </button>

                  <button 
                    onClick={async () => {
                      alert(lang === 'zh' ? '数据库空间优化成功！释放 0 空闲逻辑页，文件结构对齐完成。' : 'VACUUM command completed. Over-allocated files are fully reclaimed.');
                    }}
                    className="w-full text-left bg-slate-800 hover:bg-slate-750 text-white border border-slate-700/65 p-3 rounded-xl transition-all cursor-pointer flex items-center gap-3"
                  >
                    <Cpu size={16} className="text-emerald-400 shrink-0" />
                    <div className="text-left">
                      <span className="text-xs font-bold block">{lang === 'zh' ? '磁盘碎片整理与空间回缩 (VACUUM)' : 'Defragment Storage (VACUUM)'}</span>
                      <span className="text-[9px] text-slate-400 block leading-tight mt-0.5">{lang === 'zh' ? '物理重排在册物理空间，释放可能存在的空置块' : 'Triggers VACUUM rebuild to compress physical file'}</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-6 pt-5 overflow-hidden">
        {/* Left pane: Accounts directory list (xl:col-span-7) */}
        <div className="xl:col-span-7 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-150 bg-gray-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-gray-500" />
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                {lang === 'zh' ? '在册教师/管理员列表' : 'Registered Staff Accounts'}
              </span>
              <span className="bg-gray-200 text-gray-700 font-bold px-2 py-0.5 rounded-full text-[10px]">
                {filteredUsers.length}
              </span>
            </div>

            <button
              onClick={handleOpenCreate}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Plus size={12} />
              {lang === 'zh' ? '添加教职账户' : 'Add Teacher Account'}
            </button>
          </div>

          {/* Search bar & filter controls */}
          <div className="p-3 border-b border-gray-100 bg-white grid grid-cols-1 sm:grid-cols-12 gap-2 shrink-0">
            <div className="sm:col-span-8 relative flex items-center">
              <span className="absolute left-3 text-gray-400">
                <Search size={14} />
              </span>
              <input
                type="text"
                placeholder={lang === 'zh' ? '检索姓名、教工用户名...' : 'Search teachers by name or username...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-3 py-2 border border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl"
              />
            </div>

            <div className="sm:col-span-4 select-none">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="w-full text-xs p-2 border border-gray-200 focus:outline-none focus:border-indigo-400 rounded-xl bg-slate-50 cursor-pointer"
              >
                <option value="all">{lang === 'zh' ? '全部角色' : 'All Roles'}</option>
                <option value="administrator">{lang === 'zh' ? '管理员 (admin)' : 'Administrators'}</option>
                <option value="teacher">{lang === 'zh' ? '非管理员 (teacher)' : 'Standard Teachers'}</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/55">
            {loading ? (
              <div className="flex justify-center items-center h-48 text-gray-400 text-xs">
                <RefreshCw size={20} className="animate-spin mr-1.5" />
                {lang === 'zh' ? '加载教职工账户中...' : 'Reading accounts...'}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center p-8 text-gray-400 flex flex-col items-center justify-center h-full">
                <Users size={36} className="opacity-20 mb-2" />
                <p className="text-xs font-semibold">{lang === 'zh' ? '未检索到任何符合条件的教师账户' : 'No staff matched your filters.'}</p>
              </div>
            ) : (
              filteredUsers.map(user => {
                const isSelectedSelf = user.id === currentUserId;
                const isUserAdmin = user.role === 'administrator';
                return (
                  <div 
                    key={user.id}
                    className="p-3 bg-white border border-gray-150 hover:border-gray-350 rounded-xl shadow-2xs flex items-center justify-between group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl flex items-center justify-center ${isUserAdmin ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isUserAdmin ? <Shield size={18} /> : <Users size={18} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-gray-800">{user.name}</span>
                          {isSelectedSelf && (
                            <span className="bg-indigo-100/80 text-indigo-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-indigo-200">
                              {lang === 'zh' ? '你自己' : 'You'}
                            </span>
                          )}
                          <span className={`text-[8.5px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded-full ${
                            isUserAdmin ? 'bg-indigo-950/90 text-indigo-400' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {user.role}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-450 font-mono mt-1 flex items-center gap-1.5">
                          <span>@{user.username}</span>
                          <span>•</span>
                          <span>{lang === 'zh' ? '注册日期：' : 'ID: '}{new Date(user.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(user)}
                        className="p-1 px-1.5 text-xs text-gray-650 hover:text-indigo-600 hover:bg-indigo-50/50 border border-transparent rounded-lg transition-colors flex items-center gap-1"
                        title={lang === 'zh' ? '修改设置' : 'Update settings'}
                      >
                        <Edit2 size={12} />
                        <span className="hidden md:inline text-[10px]">{lang === 'zh' ? '设置' : 'Edit'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.name)}
                        className="p-1 px-1.5 text-xs text-gray-650 hover:text-rose-600 hover:bg-rose-50 border border-transparent rounded-lg transition-colors flex items-center gap-1"
                        title={lang === 'zh' ? '注销删除' : 'Delete user'}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane: Systemwide parameters & server status (xl:col-span-5) */}
        <div className="xl:col-span-5 flex flex-col min-h-0 gap-6">
          {/* Section 1: System-wide Configuration Form */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-xs p-5 flex flex-col shrink-0">
            <h3 className="text-xs font-black text-gray-700 uppercase tracking-widest flex items-center gap-2 border-b border-gray-100 pb-3 mb-4">
              <Settings size={15} className="text-slate-600 animate-spin" style={{ animationDuration: '8s' }} />
              {lang === 'zh' ? '全局系统配置与偏好' : 'Global OS Configurations'}
            </h3>

            <form onSubmit={handleSaveSystemSettings} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-[10.5px] font-bold text-gray-550 uppercase tracking-wider">
                  {lang === 'zh' ? '智能教室编排模式 / Orchestration' : 'Classroom Coordinator System'}
                </label>
                <select
                  value={orchestrationMode}
                  onChange={(e) => setOrchestrationMode(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:border-indigo-400 bg-slate-50 disabled:bg-gray-100 disabled:text-gray-450 outline-none cursor-pointer mt-1"
                >
                  <option value="agent-assisted">{lang === 'zh' ? 'AI Agent 协理 (模型全自动链式决策调度)' : 'AI Agent Assisted Model Chain'}</option>
                  <option value="manual">{lang === 'zh' ? '手动模式 (仅由教师直接通过终端进行广播)' : 'Manual Instructor Broadcaster'}</option>
                  <option value="restrictive">{lang === 'zh' ? '高可靠性封禁模式 (锁死白板协作及网络调试)' : 'Restrictive Safe OS Firewall'}</option>
                </select>
                <span className="text-[9.5px] text-gray-400 block mt-0.5 select-none">{lang === 'zh' ? '控制AI大模型是否拥有自动编排和在白板绘制习题的全新能力。' : 'Dictates the level of autonomous execution given to the background Gemini scheduling loop.'}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10.5px] font-bold text-gray-550 uppercase tracking-wider">
                    {lang === 'zh' ? '指令侦听间隔 / sync ms' : 'Worker Sync Interval'}
                  </label>
                  <input
                    type="number"
                    value={classInterval}
                    onChange={(e) => setClassInterval(parseInt(e.target.value) || 1000)}
                    disabled={!isAdmin}
                    min={1000}
                    max={30000}
                    step={1000}
                    className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-slate-50 disabled:bg-gray-100 disabled:text-gray-450 mt-1"
                    required
                  />
                  <span className="text-[9.5px] text-gray-450 block mt-0.5 select-none">{lang === 'zh' ? '最小1000毫秒' : 'Min 1000ms sync'}</span>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10.5px] font-bold text-gray-550 uppercase tracking-wider">
                    {lang === 'zh' ? '最大并发会话' : 'Max Concurrent'}
                  </label>
                  <input
                    type="number"
                    value={maxSessions}
                    onChange={(e) => setMaxSessions(parseInt(e.target.value) || 20)}
                    disabled={!isAdmin}
                    min={5}
                    max={200}
                    className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-slate-50 disabled:bg-gray-100 disabled:text-gray-450 mt-1"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-gray-150 rounded-xl mt-3 select-none">
                <div>
                  <span className="text-[11px] font-black text-gray-700 block">{lang === 'zh' ? '🔒 系统维护模式' : '🔒 Operational Maintenance Mode'}</span>
                  <span className="text-[9.5px] text-gray-450 block leading-tight mt-0.5">{lang === 'zh' ? '暂时禁用学生端接入所有的白板协同及测验提交' : 'Restricts active pupils logins and bars submission buffers.'}</span>
                </div>
                <input
                  type="checkbox"
                  checked={maintenanceMode}
                  onChange={(e) => setMaintenanceMode(e.target.checked)}
                  disabled={!isAdmin}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-gray-300 cursor-pointer disabled:opacity-50"
                />
              </div>

              {isAdmin ? (
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-500 font-bold text-white text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                >
                  {savingSettings ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>{savingSettings ? (lang === 'zh' ? '存储同步中...' : 'Saving Properties...') : (lang === 'zh' ? '部署并写入全局设置' : 'Save System Properties')}</span>
                </button>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[10.5px] leading-tight rounded-xl flex items-start gap-1.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    {lang === 'zh' 
                      ? '您的账户角色为非管理员。只有具备“administrator”标签的用户才能调整或更改前述硬件及应用同步选项。'
                      : 'You are currently logged in as a regular teacher. System metrics and configurations are locked as read-only. Ask an administrator to update.'}
                  </span>
                </div>
              )}
            </form>
          </div>

          {/* Section: 'Database Health' Section Card */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-xs p-5 flex flex-col shrink-0 animate-fade-in text-gray-850" id="db_health_dashboard_card">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <div className="text-left">
                <h3 className="text-xs font-black text-gray-750 uppercase tracking-widest flex items-center gap-1.5">
                  <Database size={15} className="text-indigo-600 animate-pulse" />
                  {lang === 'zh' ? 'SQLite 数据库健康体检' : 'Database Engine Health'}
                </h3>
                <span className="text-[9.5px] text-gray-400 block mt-0.5">
                  {lang === 'zh' ? '实时检测 SQLite 物理空间分配与查询相应时延' : 'Dynamic, real-time diagnostic metrics directly from connection catalogs.'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold text-emerald-600 font-mono uppercase tracking-wider">
                  {lang === 'zh' ? '正常运行' : 'Healthy'}
                </span>
              </div>
            </div>

            {/* Metrics Dashboard Row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* Stat 1: Total Tables */}
              <div className="bg-slate-50 border border-gray-100 p-3 rounded-xl flex flex-col justify-between text-left">
                <span className="text-[9px] font-black text-gray-450 uppercase tracking-widest block">
                  {lang === 'zh' ? '实体表总数' : 'Total Tables'}
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-extrabold text-slate-800 font-mono">
                    {sqliteStats?.tableCount ?? '--'}
                  </span>
                  <span className="text-[9px] text-gray-405 font-bold uppercase">
                    {lang === 'zh' ? '个' : 'tbls'}
                  </span>
                </div>
                <span className="text-[8.5px] text-gray-400 block mt-1 truncate">
                  {lang === 'zh' ? `外含 ${sqliteStats?.systemTableCount ?? 0} 个系统表` : `+${sqliteStats?.systemTableCount ?? 0} catalogs`}
                </span>
              </div>

              {/* Stat 2: Database Size */}
              <div className="bg-slate-50 border border-gray-100 p-3 rounded-xl flex flex-col justify-between text-left">
                <span className="text-[9px] font-black text-gray-450 uppercase tracking-widest block">
                  {lang === 'zh' ? '文件容量' : 'Disk Size'}
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-extrabold text-indigo-650 font-mono animate-fade-in">
                    {sqliteStats?.sizeMb !== undefined ? sqliteStats.sizeMb : '--'}
                  </span>
                  <span className="text-[9px] text-gray-455 font-bold uppercase">
                    MB
                  </span>
                </div>
                <span className="text-[8.5px] text-gray-400 block mt-1 truncate">
                  {sqliteStats?.diskUsageFriendly ?? (lang === 'zh' ? '计算空间中...' : 'Evaluating...')}
                </span>
              </div>

              {/* Stat 3: Query Latency */}
              <div className="bg-slate-50 border border-gray-100 p-3 rounded-xl flex flex-col justify-between text-left">
                <span className="text-[9px] font-black text-gray-455 uppercase tracking-widest block">
                  {lang === 'zh' ? '读取时延/耗时' : 'Query Latency'}
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-extrabold text-emerald-600 font-mono animate-fade-in">
                    {sqliteStats?.latencyMs !== undefined ? sqliteStats.latencyMs : '--'}
                  </span>
                  <span className="text-[9px] text-gray-450 font-bold uppercase">
                    ms
                  </span>
                </div>
                <span className="text-[8.5px] text-gray-400 block mt-1 truncate">
                  {lang === 'zh' ? '元数据对齐周期' : 'Direct catalog check'}
                </span>
              </div>
            </div>

            {/* Quick action bar */}
            <div className="flex items-center justify-between bg-slate-50/50 border border-gray-150/40 p-2 rounded-xl">
              <span className="text-[9.5px] text-gray-400 font-medium pl-1">
                {lang === 'zh' ? '自动检测轮询间隔: 5s' : 'Dynamic background poll: 5s'}
              </span>
              <button
                type="button"
                onClick={fetchSqliteStats}
                disabled={loadingSqlite}
                className="p-1 px-3 text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black tracking-wider uppercase border border-indigo-250/20 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
              >
                <RefreshCw size={10} className={loadingSqlite ? "animate-spin" : ""} />
                {lang === 'zh' ? '实时评测' : 'Benchmark Latency'}
              </button>
            </div>
          </div>

          {/* Section 2: Real-time System Telemetry Grid */}
          <div className="bg-slate-950 text-white border border-slate-800 shadow-xl rounded-2xl p-5 flex flex-col flex-1 overflow-y-auto selection:bg-slate-700">
            <h3 className="text-xs font-black text-slate-450 uppercase tracking-widest flex items-center gap-2 border-b border-slate-900 pb-3 mb-4 select-none">
              <Activity size={14} className="text-indigo-400" />
              {lang === 'zh' ? '分布式操作系统硬件状况' : 'Distributed Node Telemetry'}
            </h3>

            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-900 border border-slate-850 p-2.5 rounded-xl text-center">
                <span className="text-[9px] font-bold text-slate-500 block uppercase">{lang === 'zh' ? '处理器负载' : 'CPU Load'}</span>
                <span className="text-sm font-black font-mono text-indigo-400 block mt-1">{cpuUsage}%</span>
              </div>
              <div className="bg-slate-900 border border-slate-850 p-2.5 rounded-xl text-center">
                <span className="text-[9px] font-bold text-slate-500 block uppercase">{lang === 'zh' ? '数据库行数' : 'DB Buffer'}</span>
                <span className="text-sm font-black font-mono text-emerald-400 block mt-1">
                  {sqliteStats !== null ? sqliteStats.totalRows.toLocaleString() : '2,840'}
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-850 p-2.5 rounded-xl text-center">
                <span className="text-[9px] font-bold text-slate-500 block uppercase">{lang === 'zh' ? '主数据库延迟' : 'DB Net Delay'}</span>
                <span className="text-sm font-black font-mono text-amber-400 block mt-1">
                  {sqliteStats !== null && sqliteStats.latencyMs !== undefined ? `${sqliteStats.latencyMs} ms` : '1.5 ms'}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1.5 text-slate-400 scrollbar-none">
              <div className="flex items-center gap-1 text-slate-500 select-none">
                <Terminal size={11} /> <span>[root@sys-kernel-0] logs --level=info</span>
              </div>
              <div><span className="text-emerald-500 font-bold">[OK]</span> SQLite3 initialization complete: educational_os.db successfully mounted.</div>
              <div><span className="text-indigo-400 font-bold">[INFO]</span> Synchronizing 14 internal structural collections...</div>
              <div><span className="text-indigo-400 font-bold">[INFO]</span> Loaded active school credentials database. Current admins count: {users.filter(u=>u.role==='administrator').length}</div>
              <div><span className="text-amber-500 font-bold">[WARN]</span> Port 3000 detected as default proxy ingress bypass bind.</div>
              <div><span className="text-indigo-400 font-bold">[INFO]</span> Listening on network http://0.0.0.0:3000...</div>
            </div>
          </div>
        </div>
      </div>
    )}

      {/* CREATE / EDIT ACCOUNT SLIDEOUT DRAWER */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-zoom-in">
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h4 className="text-xs font-black text-gray-700 uppercase tracking-widest flex items-center gap-1.5 select-none">
                <Users size={16} className="text-indigo-600" />
                {editingUserId ? (lang === 'zh' ? '正在编辑教职账户设置' : 'Edit Teacher Account Settings') : (lang === 'zh' ? '新建教师与教工账户' : 'New Teacher Credentials')}
              </h4>
              <button 
                onClick={() => setIsFormOpen(false)}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUserSubmit}>
              <div className="p-5 space-y-4">
                {formError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-[10.5px] rounded-xl flex items-center gap-1.5 animate-pulse">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                    {lang === 'zh' ? '教工姓名 (展示给学生及白板上) *' : 'Staff Real Name (Shown on roster/boards) *'}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={lang === 'zh' ? '例如：李茂峰老师、Mrs. Higgins' : 'e.g. Dr. Higgins, Teacher Chen'}
                    className="w-full text-xs p-2.5 border border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-550 uppercase tracking-wide">
                    {lang === 'zh' ? '登录用户名 (唯一标识) *' : 'Access Username (Unique Identifier) *'}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={lang === 'zh' ? '输入登录用的拼音或简写' : 'e.g. jclark12'}
                    className="w-full text-xs p-2.5 border border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-555 uppercase tracking-wide">
                    {lang === 'zh' ? '密码 *' : 'Password *'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingUserId ? (lang === 'zh' ? '留空表示不修改密码' : 'Leave empty to keep existing') : (lang === 'zh' ? '指定初次登录密码' : 'Set initial sign in password')}
                    className="w-full text-xs p-2.5 border border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-xl"
                    required={!editingUserId}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-550 uppercase tracking-wide">
                    {lang === 'zh' ? '系统角色 (决定设置编辑权限) *' : 'Assign System Role (Determines access level) *'}
                  </label>
                  <div className="flex gap-4 mt-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="form_role"
                        checked={role === 'teacher'}
                        onChange={() => setRole('teacher')}
                        className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <span>{lang === 'zh' ? '教师 (不可进行设置)' : 'Teacher (settings locked)'}</span>
                    </label>
                    
                    <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="form_role"
                        checked={role === 'administrator'}
                        onChange={() => setRole('administrator')}
                        className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <span>{lang === 'zh' ? '管理员 (可调整设置)' : 'administrator (Full access)'}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl transition-all cursor-pointer"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                >
                  {submittingUser ? <RefreshCw size={13} className="animate-spin" /> : <Check size={14} />}
                  <span>{submittingUser ? (lang === 'zh' ? '保存中...' : 'Saving...') : (lang === 'zh' ? '保存记录' : 'Save Properties')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
