export const getCommandCategory = (commandType: string): string => {
  if (commandType.startsWith('vfs.')) return 'vfs';
  if (commandType.startsWith('lesson.') || commandType.startsWith('whiteboard.')) return 'edu';
  if (
    commandType.startsWith('class.') ||
    commandType.startsWith('student.') ||
    commandType.startsWith('assignment.') ||
    commandType.startsWith('attendance.') ||
    commandType.startsWith('schedule.')
  ) return 'mgmt';
  if (commandType.startsWith('process.')) return 'proc';
  if (commandType.startsWith('ai.')) return 'ai';
  return 'plugin';
};

export const generateInitialPayload = (schema: any): string => {
  if (!schema || schema.type !== 'OBJECT') return '{}';
  const payload: Record<string, any> = {};
  if (schema.properties) {
    Object.keys(schema.properties).forEach(key => {
      const prop = schema.properties[key];
      if (prop.type === 'ARRAY') {
        payload[key] = prop.items?.type === 'STRING' ? ["选项 A", "选项 B", "选项 C"] : [];
      } else if (prop.type === 'INTEGER' || prop.type === 'NUMBER') {
        payload[key] = 100;
      } else if (prop.type === 'BOOLEAN') {
        payload[key] = true;
      } else {
        if (key.toLowerCase().includes('id')) {
          payload[key] = 'auto-id-or-current';
        } else if (key.toLowerCase().includes('name')) {
          payload[key] = '测试名称';
        } else if (key.toLowerCase().includes('content')) {
          payload[key] = '# 初始内容\n这是一个通过命令创建的组件或段落。';
        } else {
          payload[key] = prop.description || '示例参数';
        }
      }
    });
  }
  return JSON.stringify(payload, null, 2);
};
