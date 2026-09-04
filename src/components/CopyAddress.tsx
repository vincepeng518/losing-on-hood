import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyAddress({ 
  address, 
  className = '', 
  truncate = false 
}: { 
  address: string; 
  className?: string; 
  truncate?: boolean;
}) {
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

  const display = truncate && address.length > 14
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;

  return (
    <button 
      onClick={onCopy} 
      title={`點擊複製合約地址：${address}`}
      className={`inline-flex items-center gap-1 font-mono hover:text-white transition-colors cursor-pointer ${className}`}
    >
      <span>{display}</span>
      {copied ? <Check className="h-3 w-3 text-emerald-400 shrink-0" /> : <Copy className="h-3 w-3 opacity-40 shrink-0" />}
    </button>
  );
}
