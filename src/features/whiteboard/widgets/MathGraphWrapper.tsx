import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

/**
 * 安全数学表达式求值器（不使用 eval，防止协同广播 XSS / RCE）
 */
export function safeEvaluateMath(rawExpr: string, x: number): number {
  const cleanExpr = (rawExpr || '').trim();
  if (!cleanExpr) return NaN;

  // 严禁任何可能访问属性、原型链、执行代码的危险关键字和符号
  const DANGEROUS_PATTERN = /[;={}\[\]'"`\\&|<>?!]|constructor|prototype|__proto__|window|document|fetch|eval|import|require|process/i;
  if (DANGEROUS_PATTERN.test(cleanExpr)) {
    throw new Error('表达式包含不安全字符');
  }

  // 规范化：移除 Math. 前缀，统一转小写
  const expr = cleanExpr.replace(/Math\./gi, '').toLowerCase();

  // 词法分词
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push(num);
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let ident = '';
      while (i < expr.length && /[a-z]/.test(expr[i])) {
        ident += expr[i++];
      }
      tokens.push(ident);
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    throw new Error(`不支持的符号: ${ch}`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = (expected?: string) => {
    const t = tokens[pos++];
    if (expected && t !== expected) {
      throw new Error(`预期 '${expected}'，但得到 '${t}'`);
    }
    return t;
  };

  const parseExpression = (): number => parseAddSub();

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') left = right === 0 ? NaN : left / right;
      else left %= right;
    }
    return left;
  };

  const parsePower = (): number => {
    let left = parseUnary();
    while (peek() === '^') {
      consume();
      const right = parsePower();
      left = Math.pow(left, right);
    }
    return left;
  };

  const parseUnary = (): number => {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const t = peek();
    if (!t) throw new Error('意外的表达式结尾');

    if (t === '(') {
      consume('(');
      const val = parseExpression();
      consume(')');
      return val;
    }

    if (/^[0-9.]+$/.test(t)) {
      consume();
      return parseFloat(t);
    }

    if (t === 'x') {
      consume();
      return x;
    }

    if (t === 'pi') {
      consume();
      return Math.PI;
    }
    if (t === 'e') {
      consume();
      return Math.E;
    }

    const funcName = consume();
    if (peek() === '(') {
      consume('(');
      const arg = parseExpression();
      consume(')');
      switch (funcName) {
        case 'sin': return Math.sin(arg);
        case 'cos': return Math.cos(arg);
        case 'tan': return Math.tan(arg);
        case 'sqrt': return Math.sqrt(arg);
        case 'abs': return Math.abs(arg);
        case 'log': return Math.log(arg);
        case 'exp': return Math.exp(arg);
        case 'round': return Math.round(arg);
        case 'floor': return Math.floor(arg);
        case 'ceil': return Math.ceil(arg);
        default: throw new Error(`未知的数学函数: ${funcName}`);
      }
    }

    throw new Error(`未知的数学标识符: ${t}`);
  };

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`多余语法: ${tokens.slice(pos).join(' ')}`);
  }
  return result;
}

export function MathGraphWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete
}: { 
  elementId: string; 
  data: any; 
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDelete: () => void;
}) {
  const [equation, setEquation] = useState<string>(data.equation || "sin(x)");
  const [points, setPoints] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [containerDimensions, setContainerDimensions] = useState({ width: 400, height: 300 });
  const graphContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerDimensions({
          width: entry.contentRect.width || 400,
          height: entry.contentRect.height || 300
        });
      }
    });
    observer.observe(graphContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      const generatedPoints = [];
      const centerX = containerDimensions.width / 2;
      const centerY = containerDimensions.height / 2;
      for (let xUnit = -10; xUnit <= 10; xUnit += 0.2) {
         const x = xUnit;
         const y = safeEvaluateMath(equation, x);
         if (typeof y !== 'number' || isNaN(y)) continue;
         const px = centerX + x * 20;
         const py = centerY - y * 20;
         generatedPoints.push(`${px},${py}`);
      }
      setPoints(generatedPoints.join(' '));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, [equation, containerDimensions]);

  const handleBlur = () => {
    if (onElementUpdate && equation !== data.equation) {
       onElementUpdate(elementId, { ...data, equation });
    }
  };

  return (
    <div className="w-full h-full bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-gray-100 text-gray-700 px-3 py-1.5 flex justify-between items-center text-xs border-b border-gray-300 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
         <span className="flex items-center gap-1 font-semibold text-gray-600">Math Graph Sandbox</span>
         <button 
           onClick={onDelete} 
           onPointerDown={e => e.stopPropagation()}
           className="p-1 hover:bg-gray-200 rounded-full text-gray-500 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center" 
           title="删除组件"
         >
           <Trash2 size={13} />
         </button>
      </div>
      <div className="p-3 border-b border-gray-200 flex-none flex flex-col gap-1">
         <span className="text-gray-500 text-xs">y = f(x)</span>
         <input 
            type="text" 
            value={equation} 
            onChange={e => setEquation(e.target.value)}
            onBlur={handleBlur}
            className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            placeholder="e.g. Math.sin(x) * x"
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
         />
         {error && <div className="text-red-500 text-[10px] mt-1">{error}</div>}
      </div>
      <div className="flex-1 relative overflow-hidden bg-white min-h-0" ref={graphContainerRef}>
          <svg width={containerDimensions.width} height={containerDimensions.height} viewBox={`0 0 ${containerDimensions.width} ${containerDimensions.height}`} className="absolute top-0 left-0">
             {/* Grid */}
             <line x1={containerDimensions.width / 2} y1="0" x2={containerDimensions.width / 2} y2={containerDimensions.height} stroke="#e5e7eb" strokeWidth="1" />
             <line x1="0" y1={containerDimensions.height / 2} x2={containerDimensions.width} y2={containerDimensions.height / 2} stroke="#e5e7eb" strokeWidth="1" />
             {/* Path */}
             {points && <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />}
          </svg>
      </div>
    </div>
  );
}
