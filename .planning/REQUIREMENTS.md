# Requirements: OpenLearnV2 — 作业提交与学生互评插件

**Defined:** 2026-06-20  
**Milestone:** v3.0  
**Core Value:** 以独立 ESM 插件（及微前端桥接）的方式，为授课流程增加学生作业文件上传、公开自由互评、教师评分及平时成绩自动核算和学期成绩对接。

## v3 Requirements

### PLUG-EVAL-01: 学生作业上传与版本管理
- **Description**: 学生能在当前激活的课时内，上传自己的作业/作品文件，并且支持在截止前多次更新覆盖。
- **User Story**: 
  - 作为一名学生，我希望能够在当前的课堂页面中看到“作业提交”板块，并能选择本地文件上传。
  - 作为一名 student，如果我对已提交的作业不满意，我可以重新上传新文件来覆盖之前的提交，且系统能记录最新的提交版本和时间。
- **Acceptance Criteria**:
  - 学生端有对应的作业文件上传按钮，支持上传常见文件（如 pdf, zip, jpg, png 等）。
  - 文件上传后，安全保存在宿主的虚拟文件系统（VFS）特定目录，例如 `/lessons/{lessonId}/submissions/{studentId}/` 之下。
  - 在数据库 `assignment_submissions` 表中记录提交元数据，包含 `id`、`lesson_id`、`student_id`、`file_path`、`version`（初始为 1，每次更新递增）、`created_at`、`updated_at`。
  - 若学生已提交过，再次上传时，旧提交文件的物理路径被替换/覆盖（或生成新版本文件并清理旧文件），且数据库行被更新，`version` 递增，`updated_at` 更新为当前时间。

### PLUG-EVAL-02: 自由浏览与互评系统
- **Description**: 学生可以在课中列表式浏览所有已提交的其他同学作业，查看并对每份作业进行评分（0-100分）和提交评语。
- **User Story**:
  - 作为一名学生，我希望可以浏览本班同学提交的所有作业列表，以便互相学习。
  - 作为一名学生，我可以对同学的作业进行评分并填写改进意见（评语），从而参与到互评流程中。
- **Acceptance Criteria**:
  - 学生端有“同学作业列表”页面，显示已提交的同学名单和作品下载/预览链接。
  - 学生可以对每份作品打分（0-100的整数）并填写文本评语（必填或非必填）。
  - 每个学生对同学的每份作品仅能提交一次评价。若重复提交，则覆盖先前的评分和评语。
  - 学生不能对自己的作业进行互评。
  - 互评数据保存在数据库 `assignment_peer_reviews` 表中，包含 `id`、`submission_id`、`reviewer_id`（评价者学生 ID）、`score`、`comment`、`created_at`。

### PLUG-EVAL-03: 教师评分与权重计算
- **Description**: 教师可以浏览所有学生的作业提交，查看学生间的互评详情（评语、每个学生的互评打分及平均分），对作业进行打分，并可动态配置教师评分与学生互评的成绩权重。
- **User Story**:
  - 作为一名教师，我希望在一个集中的面板上看到全班同学的作业提交状态、下载链接以及他们获得的同学互评平均分和评语列表。
  - 作为一名教师，我可以给每个作业打分，并且能配置“教师评分”和“学生互评”所占的比例，由系统自动生成该生此作业的最终平时分。
- **Acceptance Criteria**:
  - 教师端有对应的管理面板，列出所有已提交的作业、提交版本、学生互评次数、互评平均分以及具体的评语明细。
  - 教师可以输入“教师评分”和“教师评语”。
  - 教师可设置评分权重（教师权重 $W_t$，互评权重 $W_p$，满足 $W_t + W_p = 100\%$）。默认为 教师 60%，学生 40%。
  - 系统根据公式自动计算最终平时分：
    $$\text{Final Score} = \text{Teacher Score} \times W_t + \text{Peer Average Score} \times W_p$$
    *注：若某份作业没有获得任何学生互评，则平时分直接等于教师评分。*
  - 评分及权重数据保存在 `assignment_grades` 表中，包含 `id`、`submission_id`、`teacher_id`、`teacher_score`、`teacher_comment`、`calculated_final_score`、`teacher_weight`、`peer_weight`、`status`（'draft' | 'confirmed'）。

### PLUG-EVAL-04: ISemesterGradeService DI 对接
- **Description**: 插件通过宿主经由 DI 注入的 `ISemesterGradeService`，在评分确认后直连并写入宿主数据库的学期主成绩表中。
- **User Story**:
  - 作为一名教师，当我确认所有平时打分无误后，我希望点击“同步到学期成绩”按钮，将此平时成绩作为平时成绩的一部分直接计入学期总评，无需手动誊录。
- **Acceptance Criteria**:
  - 宿主核心（Packages Core）和宿主 App 定义好 `ISemesterGradeService` 接口，并使用常量 Token `@openlearn/frontend:ISemesterGradeService` 注册在服务容器中。
  - 接口定义：
    ```typescript
    export interface ISemesterGradeService {
      saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
    }
    ```
  - 教师在评分界面点击“同步/确认平时成绩”后，状态更新为 'confirmed'，插件通过 DI 容器解析 `ISemesterGradeService`，调用 `saveSemesterGrade` 方法将平时分写入宿主的学期成绩存储结构。

---

## Out of Scope

- **文件格式限制与防病毒扫描**：不做物理文件内容的安全审计和杀毒扫描，仅做简单的后缀名或文件大小（例如 < 50MB）限制。
- **自动AI评分与学术剽窃检测**：不涉及利用大模型自动评分，也不涉及代码/论文查重机制。
- **多次修改已确认成绩的审批**：一旦成绩点击“确认并同步”写入学期成绩表，插件端不允许再次更改；如需更改，必须走宿主原本的成绩修正申请。

---

## Traceability

| Requirement | Proposed Phase | Status |
|-------------|----------------|--------|
| PLUG-EVAL-01 | Phase 14 / Phase 15 | Active |
| PLUG-EVAL-02 | Phase 14 / Phase 15 | Active |
| PLUG-EVAL-03 | Phase 14 / Phase 16 | Active |
| PLUG-EVAL-04 | Phase 14 / Phase 16 | Active |

---
*Last updated: 2026-06-20*
