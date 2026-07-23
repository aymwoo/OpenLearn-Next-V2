# OpenLearn Whiteboard Rendering Engine Design Specification

> **Architecture Standard**: High-Performance Viewport-Culled Pipeline  
> **Target Subsystem**: `src/features/whiteboard/rendering-engine/`  
> **Status**: Approved & Integrated

---

## 1. System Architecture Overview

The **Rendering Engine** abstracts rendering from React view components into a high-performance pipeline capable of rendering **10,000+ Canvas Objects** smoothly.

$$\text{Canvas Document} \longrightarrow \text{Layer Manager} \longrightarrow \text{RendererRegistry} \longrightarrow \text{RenderScheduler} \longrightarrow \text{Canvas Renderer} \longrightarrow \text{React View}$$

---

## 2. Render Pipeline Mermaid Diagram

```mermaid
flowchart TD
    Start["Start Frame Render Cycle"] --> Collect["1. Collect All Objects from Document"]
    Collect --> SortLayer["2. Layer Manager: Sort Objects by Layer zIndex"]
    SortLayer --> SortZ["3. Sort Objects by Object zIndex"]
    SortZ --> ViewportCull["4. VirtualRenderer: Viewport Culling (AABB Filter)"]
    ViewportCull --> DirtyCheck["5. DirtyRegionManager: Invalidation Check"]
    DirtyCheck --> Queue["6. RenderScheduler: Enqueue Priority Jobs & Time-Slicing"]
    Queue --> BatchDraw["7. Batch Draw via RendererRegistry.getRenderer(type)"]
    BatchDraw --> Commit["8. Commit Frame to Canvas View & Update FPS Stats"]
```

---

## 3. Layer Architecture Diagram (Mermaid)

```mermaid
graph TD
    subgraph Layer_Stack ["Multi-Layer Composite Stack"]
        L0["Layer 0: Background Layer (Grid, Pattern, Wallpaper)"]
        L1["Layer 1: Teacher Content Layer (Text, Shapes, Images)"]
        L2["Layer 2: Student Content Layer (Interactions, Responses)"]
        L3["Layer 3: Plugin Widgets Layer (GeoGebra, Code, Sandboxes)"]
        L4["Layer 4: AI Agent Layer (AI Tutors, Generated Content)"]
        L5["Layer 5: Smart Guide Layer (Alignment Guidelines, Snap)"]
        L6["Layer 6: Selection & Overlay Layer (8 Resize Handles, BBox)"]
    end

    L0 --> L1
    L1 --> L2
    L2 --> L3
    L3 --> L4
    L4 --> L5
    L5 --> L6
```

---

## 4. Key Subsystems & Responsibilities

| Subsystem | Responsibilities |
|---|---|
| **`RendererRegistry`** | Pluggable Object Renderer registry. Supports `registerRenderer()`, `overrideRenderer()`. |
| **`VirtualRenderer`** | Viewport Culling. Filters out canvas objects outside current viewport to sustain 60 FPS for 10,000+ objects. |
| **`RenderScheduler`** | Time-sliced priority queue (`Immediate`, `AnimationFrame`, `Idle`, `Background`) preventing UI jank. |
| **`DirtyRegionManager`** | Partial invalidation engine to avoid full canvas re-renders on minor drag/resize actions. |
| **`HighDPIController`** | `devicePixelRatio` scaling controller ensuring sharp rendering across Mac Retina, Windows & Linux. |
| **`PerformanceMonitor`** | Real-time FPS, draw calls, visible/culled object counts, and memory monitoring. |
