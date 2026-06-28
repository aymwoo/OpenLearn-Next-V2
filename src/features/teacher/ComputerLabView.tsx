import React from 'react';
import { ComputerLabManager } from '../../components/ComputerLabManager';

interface ComputerLabViewProps {
  computerLabs: any[];
  onRefresh: () => Promise<void>;
  lang: string;
}

export function ComputerLabView({ computerLabs, onRefresh, lang }: ComputerLabViewProps) {
  return <ComputerLabManager computerLabs={computerLabs} onRefresh={onRefresh} lang={lang} />;
}
