/**
 * 通用考试课件 FIXTURE 的消息构造器。
 *
 * 三套 fixture（server/fixtures/demo-courseware/*.html）各自按「任意 LMS 通用」
 * 的 postMessage 协议上报：本模块按 fixture 源码中写死的协议形态，构造学生作答
 * 后会产生的那条消息（type + payload）。
 *
 * 注意：这是对 fixture 协议的**权威建模**（协议本身写在 fixture 的 <script> 里，
 * 修改 fixture 协议时必须同步本文件——L2 同步守护测试覆盖不了这层，属于手工契约）。
 */

interface LmsMessage {
  type: string;
  payload: any;
}

/** FIXTURE #1 simple-quiz.html —— 学生点「提交答卷」触发 LMS_SUBMIT（默认按 2 对 1 错 = 60/90 分） */
export function readLmsSubmitFromFixture(_html: string, overrideScore?: { score?: number; completion?: number }): LmsMessage {
  return {
    type: 'LMS_SUBMIT',
    payload: {
      score: overrideScore?.score ?? 60,
      completion: overrideScore?.completion ?? 1.0,
      comment: 'simple-quiz 提交',
    },
  };
}

/** FIXTURE #2 result-screen-quiz.html —— 结算页探测：Bridge SDK 读 #correctCount X/Y 换算百分制后 LMS_FINISH */
export function readLmsFinishFromFixture(
  _html: string,
  overrideScore?: { score?: number; completion?: number; comment?: string },
): LmsMessage {
  return {
    type: 'LMS_FINISH',
    payload: {
      score: overrideScore?.score ?? 80,
      completion: 1.0,
      comment: '结算页自动提取得分',
    },
  };
}

/** FIXTURE #3 fill-answers-quiz.html —— 每题答完 LMS_SAVE_PROGRESS 增量上报 */
export function readLmsSaveProgressFromFixture(
  _html: string,
  overrideScore?: { score?: number; completion?: number },
): LmsMessage {
  return {
    type: 'LMS_SAVE_PROGRESS',
    payload: {
      score: overrideScore?.score ?? 0,
      completion: overrideScore?.completion ?? 0,
    },
  };
}

export type { LmsMessage };
