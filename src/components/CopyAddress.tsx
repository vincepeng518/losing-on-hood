import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyAddress({ address, className = '' }: { address: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();  // 不觸發外層卡片展開
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = address; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={onCopy} title="點擊複製地址"
      className={`inline-flex items-center gap-1 font-mono hover:text-white transition-colors cursor-pointer ${className}`}>
      {address}
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-40" />}
    </button>
  );
}
