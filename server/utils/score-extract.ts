/**
 * 通用 payload 分数/评语/完成度探测（从课件上报的任意形态 payload 中提取）。
 *
 * 历史上是 server/routes/courseware.ts 路由注册闭包内的函数；
 * 抽取为导出模块：路由与测试（courseware-score-capture-e2e）共用同一实现，
 * 消除「测试手工复制生产逻辑」的漂移风险。
 */
export function extractScoreCommentCompletion(payload: any) {
  let score: any = undefined;
  let comment: any = undefined;
  let completion: any = undefined;

  const keysToSearch = {
    score: ['score', 'grade', 'result', 'point', 'points', 'mark', 'marks', 'score_val', 'scoreval'],
    comment: ['comment', 'feedback', 'msg', 'message', 'text', 'note', 'memo'],
    completion: ['completion', 'progress', 'done', 'finished', 'completed', 'percentage'],
  };

  const searchObj = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      const lowerKey = key.toLowerCase();

      if (keysToSearch.score.includes(lowerKey) && score === undefined) {
        score = obj[key];
      }
      if (keysToSearch.comment.includes(lowerKey) && comment === undefined) {
        comment = obj[key];
      }
      if (keysToSearch.completion.includes(lowerKey) && completion === undefined) {
        completion = obj[key];
      }
    }

    for (const key in obj) {
      if (obj[key] && typeof obj[key] === 'object') {
        for (const subKey in obj[key]) {
          const lowerSubKey = subKey.toLowerCase();
          if (keysToSearch.score.includes(lowerSubKey) && score === undefined) {
            score = obj[key][subKey];
          }
          if (keysToSearch.comment.includes(lowerSubKey) && comment === undefined) {
            comment = obj[key][subKey];
          }
          if (keysToSearch.completion.includes(lowerSubKey) && completion === undefined) {
            completion = obj[key][subKey];
          }
        }
      }
    }
  };

  if (payload && typeof payload === 'object') {
    searchObj(payload);

    const urlString = payload.url || payload.action || '';
    if (typeof urlString === 'string' && urlString.includes('?')) {
      try {
        const queryPart = urlString.split('?')[1];
        const params = new URLSearchParams(queryPart);
        const queryObj: any = {};
        params.forEach((value, key) => {
          queryObj[key] = value;
        });
        searchObj(queryObj);
      } catch (e) {}
    }

    const bodyOrData = payload.data || payload.body;
    if (bodyOrData) {
      if (typeof bodyOrData === 'object') {
        searchObj(bodyOrData);
      } else if (typeof bodyOrData === 'string') {
        let parsed = null;
        try {
          parsed = JSON.parse(bodyOrData);
        } catch (e) {
          try {
            const params = new URLSearchParams(bodyOrData);
            const formObj: any = {};
            let hasKeys = false;
            params.forEach((value, key) => {
              formObj[key] = value;
              hasKeys = true;
            });
            if (hasKeys) {
              parsed = formObj;
            }
          } catch (e2) {}
        }
        if (parsed && typeof parsed === 'object') {
          searchObj(parsed);
        }
      }
    }
  }

  return { score, comment, completion };
}
