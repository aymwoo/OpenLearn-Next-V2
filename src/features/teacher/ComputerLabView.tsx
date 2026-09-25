import React from 'react';
import { ComputerLabManager } from '../../components/ComputerLabManager';

interface ComputerLabViewProps {
  computerLabs: any[];
  onRefresh: () => Promise<void>;
  lang: string;
  classes?: any[];
}

export function ComputerLabView({ computerLabs, onRefresh, lang, classes = [] }: ComputerLabViewProps) {
  return <ComputerLabManager computerLabs={computerLabs} onRefresh={onRefresh} lang={lang as 'zh' | 'en'} classes={classes} />;
}
