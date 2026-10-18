import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StudentPrivateNotesEditor } from '../StudentPrivateNotesEditor';

afterEach(() => {
  cleanup();
});

describe('StudentPrivateNotesEditor 私有备忘净化', () => {
  it('加载历史脏数据时先净化再写入编辑器，脚本与事件属性不会进入 DOM', () => {
    const initialValue = JSON.stringify({
      category: 'SpecialCare',
      html: '<div>需重点关注</div><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>',
    });
    const { container } = render(
      <StudentPrivateNotesEditor studentId="s1" studentName="学生甲" initialValue={initialValue} onSave={vi.fn()} />,
    );

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editor).toBeTruthy();
    expect(editor.textContent).toContain('需重点关注');
    expect(editor.querySelector('img')).toBeNull();
    expect(editor.querySelector('script')).toBeNull();
    expect(editor.innerHTML).not.toContain('onerror');
  });

  it('保存前净化编辑器内容，onSave 收到的是净化后的 JSON', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <StudentPrivateNotesEditor studentId="s1" studentName="学生甲" initialValue="" onSave={onSave} />,
    );

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    editor.innerHTML = '<div onclick="alert(1)">备注</div><img src=x onerror="alert(2)">';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('保存备忘档案'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(onSave.mock.calls[0][0] as string);
    expect(payload.category).toBe('General');
    expect(payload.html).toContain('备注');
    expect(payload.html).not.toContain('<img');
    expect(payload.html).not.toContain('onclick');
    expect(payload.html).not.toContain('onerror');
  });
});
