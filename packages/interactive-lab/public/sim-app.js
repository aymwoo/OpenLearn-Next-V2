/**
 * 虚拟电路探究实验应用逻辑
 * 运行于独立沙箱 iframe 中，与宿主白板及 LMS Bridge 双向协同
 */

(function () {
  let isClosed = false;
  let voltage = 12;
  let resistance = 10;

  function getElements() {
    return {
      bulb: document.getElementById('bulbIcon'),
      meter: document.getElementById('meterDisplay'),
      switchBtn: document.getElementById('switchBtn'),
      voltageInput: document.getElementById('voltageInput'),
      resistanceInput: document.getElementById('resistanceInput'),
      alert: document.getElementById('statusAlert'),
    };
  }

  function updateDisplay() {
    const el = getElements();
    if (!el.meter) return;

    voltage = parseFloat(el.voltageInput.value) || 12;
    resistance = parseFloat(el.resistanceInput.value) || 10;

    if (!isClosed) {
      el.bulb.classList.remove('lit');
      el.meter.classList.remove('active');
      el.meter.innerText = '0.00 A (断路)';
      el.switchBtn.classList.remove('closed');
      el.switchBtn.innerText = '🔌 闭合电键 (形成回路)';
    } else {
      const current = (voltage / resistance).toFixed(2);
      el.bulb.classList.add('lit');
      el.meter.classList.add('active');
      el.meter.innerText = `${current} A (回路正常)`;
      el.switchBtn.classList.add('closed');
      el.switchBtn.innerText = '⚡ 断开电键 (安全断电)';
    }
  }

  window.onParamChange = function () {
    updateDisplay();
    // 进度自动同步至白板图元数据
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'courseware.progress_saved',
            payload: { isClosed, voltage, resistance },
          },
          '*',
        );
      }
    } catch (_) {}
  };

  window.toggleSwitch = function () {
    isClosed = !isClosed;
    updateDisplay();
    window.onParamChange();
  };

  window.submitResult = function () {
    const el = getElements();
    if (!isClosed) {
      if (el.alert) {
        el.alert.className = 'status-alert warning';
        el.alert.innerText = '⚠️ 请先闭合开关形成通路，再行提交实验数据！';
      }
      return;
    }

    const current = parseFloat((voltage / resistance).toFixed(2));
    const labResult = {
      score: 100,
      is_passed: true,
      detail: {
        voltage,
        resistance,
        current,
        formula: 'I = U / R (欧姆定律)',
        verifiedAt: Date.now(),
      },
    };

    // 1. 标准 LMS Bridge 通信
    try {
      if (window.LMS && typeof window.LMS.submit === 'function') {
        window.LMS.submit(100, labResult.detail);
      }
    } catch (_) {}

    // 2. 向上级宿主 postMessage 上报成绩与实验记录
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'lms.submit_score',
            payload: labResult,
          },
          '*',
        );

        window.parent.postMessage(
          {
            type: 'ext-interactive-lab.circuit.submit',
            payload: labResult,
          },
          '*',
        );
      }
    } catch (_) {}

    if (el.alert) {
      el.alert.className = 'status-alert success';
      el.alert.innerText = `✓ 欧姆定律验证成功！(I = ${current}A) 实验记录已上报，教学环节门禁已放行。`;
    }
  };

  // 初始化视口
  document.addEventListener('DOMContentLoaded', () => {
    updateDisplay();
  });
})();
