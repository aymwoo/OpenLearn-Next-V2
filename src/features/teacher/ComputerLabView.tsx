import React from 'react';
import { ComputerLabManager } from '../../components/ComputerLabManager';
import { useOptionalAppData } from '../../context/AppDataContext';

export interface ComputerLabViewProps {
  computerLabs?: any[];
  onRefresh?: () => Promise<void>;
  lang?: string;
  classes?: any[];
}

export function ComputerLabView(props: ComputerLabViewProps = {}) {
  const appData = useOptionalAppData();
  const computerLabs = props.computerLabs ?? appData?.computerLabs ?? [];
  const onRefresh = props.onRefresh ?? appData?.fetchLabs ?? (async () => {});
  const lang = props.lang ?? (appData?.lang as 'zh' | 'en') ?? 'zh';
  const classes = props.classes ?? appData?.classes ?? [];

  return (
    <ComputerLabManager
      computerLabs={computerLabs}
      onRefresh={onRefresh}
      lang={lang as 'zh' | 'en'}
      classes={classes}
    />
  );
}
