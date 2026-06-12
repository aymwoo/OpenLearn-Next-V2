# Plan: Add Random Student Picker to Whiteboard Sidebar

## 1. Problem Analysis
The "Random Student Picker" (随机点名小工具) plugin (`ext-roll-call`) is activated on the backend and frontend. However, it cannot be found directly in the Interactive Whiteboard UI.
* **Root Cause**:
  1. In [App.tsx](file:///home/wuxf/Develop/openlearnv2/src/App.tsx), the "Drag to Whiteboard" sidebar widget panel (lines 4862-4913) does not contain a draggable item for `'rollcall'`.
  2. In [InteractiveWhiteboard.tsx](file:///home/wuxf/Develop/openlearnv2/src/components/InteractiveWhiteboard.tsx), the `onDrop` handler (lines 2383-2437) does not handle the `payload.type === 'rollcall'` case, so even if dropped, it won't be added.
  3. Currently, the widget is only created if the `rollcall.pick` command is executed manually with a `lessonId` via the Developer Command API / Help Tab.

## 2. Proposed Changes
### A. Update [App.tsx](file:///home/wuxf/Develop/openlearnv2/src/App.tsx)
Add a new draggable card for the Random Student Picker in the "Drag to Whiteboard" panel:
```tsx
<div draggable onDragStart={(e) => { 
   const dataStr = JSON.stringify({ type: 'rollcall', classId: selectedLesson?.class_id || 'default-class' }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/json', dataStr); e.dataTransfer.setData('text/plain', dataStr); e.dataTransfer.setData('text', dataStr);
}} className="bg-white border text-center border-gray-200 p-4 rounded-xl shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-grab active:cursor-grabbing flex flex-col items-center gap-2" >
   <Shuffle size={24} className="text-gray-500" />
   <span className="font-medium text-xs xl:text-sm text-gray-700">随机点名</span>
</div>
```

### B. Update [InteractiveWhiteboard.tsx](file:///home/wuxf/Develop/openlearnv2/src/components/InteractiveWhiteboard.tsx)
Add the `'rollcall'` handler in the `onDrop` event:
```tsx
else if (payload.type === 'rollcall') {
   await onElementAdd('rollcall', {
       classId: payload.classId || 'default-class',
       selectedStudent: null,
       allStudents: [],
       status: 'idle',
       x: dropX,
       y: dropY,
       page: currentPage,
       pageIndex: currentPage, // some elements use pageIndex
       segmentId: activeSegmentId
   });
}
```

## 3. Verification Plan
1. Launch the web application and navigate to the Whiteboard view of a lesson.
2. Verify that the "随机点名" (Random Student Picker) card is present in the "Drag to Whiteboard" sidebar.
3. Drag the widget card and drop it onto the whiteboard.
4. Verify that the "随机点名助手" widget appears on the whiteboard.
5. Click "开始随机点名" and verify it functions properly (scrolls through student names and selects one).
