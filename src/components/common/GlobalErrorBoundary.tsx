import React, { Component, type ReactNode } from 'react';
import { AlertOctagon, Copy, Check, RefreshCw, Home, ChevronDown, ChevronRight } from 'lucide-react';
import { errorStore, formatSingleErrorReport } from '../../store/errorStore';
import { copyToClipboard } from '../../utils/clipboard';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
  showDetails: boolean;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    showDetails: false,
  };
  public props: Props;
  declare setState: (state: Partial<State> | ((prev: State) => Partial<State>), callback?: () => void) => void;

  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });

    // Automatically record to global error store
    errorStore.getState().addError({
      type: 'react',
      title: 'React 组件渲染异常',
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack || undefined,
    });

    console.error('[GlobalErrorBoundary] Unhandled React render exception:', error, errorInfo);
  }

  private handleCopy = async () => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    const report = formatSingleErrorReport({
      id: 'react-boundary',
      type: 'react',
      title: 'React 组件渲染致命异常',
      message: error.message || String(error),
      stack: error.stack,
      componentStack: errorInfo?.componentStack || undefined,
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
    });

    const success = await copyToClipboard(report);
    if (success) {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    }
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false, showDetails: false });
  };

  private handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const { error, errorInfo, copied, showDetails } = this.state;
      const title = this.props.fallbackTitle || '界面渲染遇到意外错误';

      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 select-text">
          <div className="max-w-2xl w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-rose-200 dark:border-rose-900/60 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-500 to-red-600 px-6 py-5 text-white flex items-center gap-3.5">
              <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-xs shrink-0">
                <AlertOctagon size={24} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold leading-snug">{title}</h1>
                <p className="text-xs text-rose-100 mt-0.5">
                  OpenLearn 捕获到界面异常，已阻止整页崩溃并为您保留了诊断报告。
                </p>
              </div>
            </div>

            {/* Error Message Callout */}
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1.5">
                  错误摘要 (Error Summary)
                </label>
                <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3.5 text-rose-900 dark:text-rose-200 text-sm font-mono break-all">
                  {error?.name}: {error?.message || '未知异常'}
                </div>
              </div>

              {/* Collapsible Details */}
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => this.setState({ showDetails: !showDetails })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                >
                  <span>查看调用堆栈与排查信息</span>
                  {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                {showDetails && (
                  <div className="p-4 bg-slate-900 text-slate-200 text-xs font-mono max-h-64 overflow-y-auto space-y-3 leading-relaxed">
                    {error?.stack && (
                      <div>
                        <span className="text-rose-400 font-bold block mb-1">Stack Trace:</span>
                        <pre className="whitespace-pre-wrap text-[11px] opacity-90">{error.stack}</pre>
                      </div>
                    )}
                    {errorInfo?.componentStack && (
                      <div className="pt-2 border-t border-slate-800">
                        <span className="text-amber-400 font-bold block mb-1">Component Stack:</span>
                        <pre className="whitespace-pre-wrap text-[11px] opacity-80">{errorInfo.componentStack}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={this.handleCopy}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
                      copied
                        ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/30'
                    }`}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? '✓ 诊断报告已复制！' : '一键复制错误报告'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={this.handleReset}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    <span>重新加载界面</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={this.handleGoHome}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Home size={14} />
                  <span>返回系统主页</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
