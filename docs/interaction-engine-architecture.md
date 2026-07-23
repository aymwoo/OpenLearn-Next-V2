# OpenLearn Whiteboard Interaction Engine Architecture

> **Architecture Standard**: Decoupled Event-Driven Interaction Pipeline  
> **Target Subsystem**: `src/features/whiteboard/interaction-engine/`  
> **Status**: Approved & Integrated

---

## 1. System Architecture Overview

The **Interaction Engine** cleanly decouples React UI components from complex pointer, keyboard, gesture, transformation, snapping, and clipboard handling.

$$\text{React UI / Event Handler} \longrightarrow \text{InteractionManager} \longrightarrow \text{Tool / Pipeline} \longrightarrow \text{CommandManager} \longrightarrow \text{Canvas State}$$

### Core Subsystems:
1. **`InteractionManager`**: Central entry point coordinating all interaction managers.
2. **`PointerStateMachine`**: Enforces strict pointer states (`Idle`, `Selecting`, `Dragging`, `Drawing`, `Resizing`, `Rotating`, `Editing`, `Panning`, `Zooming`, etc.), replacing raw boolean flags.
3. **`ToolManager`**: Pluggable Tool System (`PointerTool`, `HandTool`, `PenTool`, `ShapeTool`, `TextTool`, and third-party plugin tools).
4. **`ViewportController`**: Manages infinite canvas pan, zoom, fit-to-screen, and zoom-to-selection camera transformations.
5. **`TransformManager`**: 8-handle resizing, ratio locking (Shift), center scaling (Alt), and 15° rotation snapping.
6. **`SnapEngine` & `GuideEngine`**: Grid snapping and smart alignment guidelines (horizontal/vertical align).
7. **`ShortcutEngine` & `ClipboardService`**: Centralized keybindings (Undo, Redo, Copy, Paste, Duplicate, Delete) and in-memory object clipboard.

---

## 2. Pointer Event Pipeline Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Pointer
    participant UI as React UI (Stage / Canvas)
    participant IM as InteractionManager
    participant SM as PointerStateMachine
    participant TM as ToolManager (Active Tool)
    participant GE as GuideEngine / SnapEngine
    participant CM as CommandManager
    participant EB as CanvasEventBus

    User->>UI: PointerDown (x, y)
    UI->>IM: handlePointerDown(ctx, page)
    IM->>TM: activeTool.onPointerDown(ctx, page)
    TM-->>IM: { nextState: "Dragging" / "Drawing" }
    IM->>SM: transitionTo("Dragging")
    IM->>UI: Update Cursor ("move")

    User->>UI: PointerMove (dx, dy)
    UI->>IM: handlePointerMove(ctx, page)
    IM->>GE: calculateSmartGuides(targetBox, page)
    GE-->>IM: { point: snappedPos, guides: [...] }
    IM-->>UI: Render Smart Guides & Live BBox

    User->>UI: PointerUp
    UI->>IM: handlePointerUp(ctx, page)
    IM->>CM: executeCommand(MoveObjectCommand)
    CM->>EB: emit("ObjectUpdated")
    IM->>SM: transitionTo("Idle")
    IM->>UI: Clear Guides & Reset Cursor
```

---

## 3. Subsystem Interconnection Architecture

```mermaid
graph TD
    subgraph UI_Layer ["React UI Layer"]
        InteractiveWhiteboard["InteractiveWhiteboard.tsx"]
        KonvaStage["Konva Stage / Touch Container"]
    end

    subgraph Interaction_Engine ["Interaction Engine Kernel"]
        IM["InteractionManager"]
        PSM["PointerStateMachine"]
        TM["ToolManager"]
        VC["ViewportController"]
        TRM["TransformManager"]
        SE["SnapEngine"]
        GE["GuideEngine"]
        SCE["ShortcutEngine"]
        CBS["ClipboardService"]
        CMM["ContextMenuManager"]
        CUM["CursorManager"]
        TEM["TextEditingManager"]
      end

    subgraph Canvas_Model ["Canvas Object Model Kernel"]
        OM["ObjectRegistry"]
        CM["CommandManager"]
        EB["CanvasEventBus"]
    end

    KonvaStage -->|Pointer Events| IM
    InteractiveWhiteboard -->|Keyboard Events| SCE
    
    IM --> PSM
    IM --> TM
    IM --> VC
    IM --> TRM
    IM --> SE
    IM --> GE
    IM --> CMM
    IM --> CUM
    IM --> TEM

    TM -->|Generates| CM
    SCE -->|Executes| CM
    CBS -->|Clones via| OM
    CM --> EB
```
