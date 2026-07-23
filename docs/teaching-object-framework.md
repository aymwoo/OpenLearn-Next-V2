# OpenLearn Teaching Object Framework Design Specification

> **Architecture Standard**: Semantic Teaching Object Subsystem  
> **Target Subsystem**: `src/features/whiteboard/teaching-object/`  
> **Status**: Approved & Integrated

---

## 1. System Architecture Overview

The **Teaching Object Framework** wraps standard low-level `CanvasObject<T>` entities with rich **Teaching Semantics**, declaratively exposed capabilities, unified lifecycles, assessment scoring interfaces, learning analytics tracking, and universal AI prompts.

$$\text{Canvas Document} \longrightarrow \text{Canvas Object<T>} \longrightarrow \text{Teaching Object<T>} \longrightarrow \text{Teaching Engine}$$

---

## 2. Architecture Mermaid Diagram

```mermaid
graph TD
    subgraph Core_Model ["Canvas Core Model"]
        CanvasObject["CanvasObject&lt;T&gt;"]
    end

    subgraph Teaching_Object_Layer ["Teaching Object Framework Layer"]
        TeachingObject["TeachingObject&lt;T&gt;"]
        TeachingCategory["Category: Content | Programming | Interactive | Learning | AI | Plugin"]
        TeachingMetadata["TeachingMetadata (Subject, Grade, KnowledgePoint, Goal)"]
        TeachingCapabilities["TeachingCapabilities (Editable, Runnable, Scorable, AIEval)"]
    end

    subgraph Subsystem_Engine ["Teaching Subsystems"]
        LifecycleManager["TeachingLifecycleManager (Create -> Active -> Destroy)"]
        RuntimeManager["TeachingRuntimeManager (Run, Pause, Stop, Reset)"]
        EventBus["TeachingEventBus (QuizSubmitted, CodeExecuted, AIFinished)"]
        Assessment["AssessmentInterface (score, submit, review)"]
        Analytics["LearningAnalyticsEngine (participation, completion, error rate)"]
        AI["AIInterface (summarize, explain, evaluate, translate)"]
    end

    CanvasObject --> TeachingObject
    TeachingObject --> TeachingCategory
    TeachingObject --> TeachingMetadata
    TeachingObject --> TeachingCapabilities

    TeachingObject --> LifecycleManager
    TeachingObject --> RuntimeManager
    TeachingObject --> EventBus
    TeachingObject --> Assessment
    TeachingObject --> Analytics
    TeachingObject --> AI
```

---

## 3. Teaching Object Class Diagram (Mermaid)

```mermaid
classDiagram
    class CanvasObject~T~ {
        +string id
        +string type
        +Point2D position
        +Size2D size
        +T payload
    }

    class TeachingObject~T~ {
        +TeachingCategory category
        +TeachingCapabilities capabilities
        +TeachingMetadata teachingMetadata
        +TeachingLifecycleStage lifecycleStage
        +TeachingRuntimeStatus runtimeStatus
    }

    class TeachingCapabilities {
        +boolean editable
        +boolean runnable
        +boolean answerable
        +boolean scorable
        +boolean collaborative
        +boolean presentable
        +boolean replayable
        +boolean evaluatable
        +boolean aiEditable
        +boolean pluginExtendable
    }

    class TeachingMetadata {
        +string title
        +string subject
        +string grade
        +string knowledgePoint
        +string difficulty
        +string teachingGoal
    }

    CanvasObject <|-- TeachingObject
    TeachingObject "1" *-- "1" TeachingCapabilities
    TeachingObject "1" *-- "1" TeachingMetadata
```

---

## 4. 6 Teaching Object Categories

| Category | Typical Object Types |
|---|---|
| **Content Object** | Markdown, Rich Text, Formula, Image, Video, Audio, PDF, Slide, Document, Website |
| **Programming Object** | Code Sandbox, Python, JavaScript, Blockly, Jupyter Notebook, Terminal |
| **Interactive Object** | Quiz, Poll, Vote, Question, Discussion, Brainstorm, Random Picker, Timer |
| **Learning Object** | Assignment, Worksheet, Scratch Area, MindMap, Knowledge Card, Flash Card |
| **AI Object** | AI Chat, AI Tutor, AI Hint, AI Question, AI Summary, AI Translation, AI Evaluation |
| **Plugin Object** | Third-Party Teaching Plugins (GeoGebra, ChemDraw, Simulation) |
