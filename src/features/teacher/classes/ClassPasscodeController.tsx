import { ClassType } from '../../../types/app';

export interface ClassPasscodeControllerProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  fetchClasses: () => Promise<void>;
}

export function ClassPasscodeController({ cls, lang, fetchClasses }: ClassPasscodeControllerProps) {
  return (
    <div className="mb-4 bg-gradient-to-r from-indigo-50/70 to-violet-50/70 p-3.5 rounded-2xl border border-indigo-150/40 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-left" onClick={(e) => e.stopPropagation()}>
      <div className="space-y-1 text-left">
        <div className="flex items-center gap-1.5 justify-start">
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
          <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">{lang === 'zh' ? '临时班级密码 (支持学生快速一键密码登录)' : 'Temporary Class Passcode'}</span>
        </div>
        <p className="text-[10px] text-indigo-600/80 font-semibold leading-relaxed text-left block">
          {lang === 'zh' ? '开始课堂后，全班学生均可使用此特定临时密码统一安全登录，无需强制输入个人自设密码。' : 'Once set, any pupil in this class can use this temporary passcode to log in directly.'}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 justify-end">
        <input
          id={`class-passcode-${cls.id}`}
          type="text"
          value={cls.class_passcode || ""}
          onChange={async (e) => {
            const val = e.target.value;
            await fetch(`/api/classes/${cls.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ class_passcode: val })
            });
            await fetchClasses();
          }}
          placeholder={lang === 'zh' ? '暂未设定 / 留空禁用' : 'Disabled / Enter code'}
          className="border border-indigo-200/80 rounded-xl text-xs px-2.5 py-1.5 w-36 text-center bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-gray-800 focus:border-transparent transition-all"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={async (e) => {
            e.stopPropagation();
            // Generate random 4 digit PIN
            const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
            await fetch(`/api/classes/${cls.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ class_passcode: randomPin })
            });
            await fetchClasses();
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] p-2 py-1.5 font-black shadow-xs transition-all hover:shadow-sm cursor-pointer shrink-0"
          title={lang === 'zh' ? '随机生成班级密码' : 'Generate random passcode'}
        >
          {lang === 'zh' ? '随机生成' : 'Random Gen'}
        </button>
        {cls.class_passcode && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              await fetch(`/api/classes/${cls.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ class_passcode: null })
              });
              await fetchClasses();
            }}
            className="bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-[10px] p-2 py-1.5 font-bold shadow-xs transition-colors cursor-pointer shrink-0"
            title={lang === 'zh' ? '清除临时密码' : 'Clear temporary passcode'}
          >
            {lang === 'zh' ? '清除' : 'Clear'}
          </button>
        )}
      </div>
    </div>
  );
}
