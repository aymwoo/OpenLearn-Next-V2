/**
 * 国家智慧教育公共服务平台前端插件装配模块
 *
 * 注册核心扩展槽：
 * - course.list.toolbar.action: 国家平台精品课导入按钮与弹窗
 * - course.card.badge: 国家精品课 / 部优示范课官方认证角标
 * - course.card.action: 课程卡片国家云上报快捷动作
 * - editor.segment.action: 步骤工具栏国家微课资源切片插入
 * - classroom.alert.banner: 课堂中控双师通道连通提示
 * - classroom.stage.display.ticker: 大屏展台示范课广播跑马灯
 * - classroom.post_class.exporter: CELTS-3 规范学情包导出
 * - header.status_pill: 全局顶栏国家平台连通呼吸灯
 * - admin.dashboard.card: 管理后台平台直连看板
 */

import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import { SmartEduCourseToolbarAction } from './components/SmartEduCourseToolbarAction';
import { SmartEduCourseBadge } from './components/SmartEduCourseBadge';
import { SmartEduCourseCardAction } from './components/SmartEduCourseCardAction';
import { SmartEduSegmentAction } from './components/SmartEduSegmentAction';
import { SmartEduAlertBanner } from './components/SmartEduAlertBanner';
import { SmartEduStageTicker } from './components/SmartEduStageTicker';
import { SmartEduPostClassExporter } from './components/SmartEduPostClassExporter';
import { SmartEduHeaderStatusPill } from './components/SmartEduHeaderStatusPill';
import { SmartEduAdminCard } from './components/SmartEduAdminCard';

export const SMART_EDU_PLUGIN_ID = 'ext-national-smart-edu';

export function registerSmartEduExtensions() {
  const store = usePluginHostStore.getState();

  // 1. 备课中心：课程管理工具栏导入按钮
  store.registerExtensionPoint('course.list.toolbar.action', {
    id: 'smart-edu-toolbar-import',
    label: '国家平台导入',
    icon: 'Sparkles',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduCourseToolbarAction as any }),
  });

  // 2. 备课中心：课程卡片国家精品课角标
  store.registerExtensionPoint('course.card.badge', {
    id: 'smart-edu-card-badge',
    label: '国家精品课徽标',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduCourseBadge as any }),
  });

  // 3. 备课中心：课程卡片上报国家云动作
  store.registerExtensionPoint('course.card.action', {
    id: 'smart-edu-card-action',
    label: '上报国家云',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduCourseCardAction as any }),
  });

  // 4. 备课中心：环节工具栏插入国家微课
  store.registerExtensionPoint('editor.segment.action', {
    id: 'smart-edu-segment-action',
    label: '插入国家微课',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduSegmentAction as any }),
  });

  // 5. 课堂互动：驾驶舱顶部双师通道横幅
  store.registerExtensionPoint('classroom.alert.banner', {
    id: 'smart-edu-alert-banner',
    label: '国家平台双师通道广播',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduAlertBanner as any }),
  });

  // 6. 课堂互动：展台大屏跑马灯
  store.registerExtensionPoint('classroom.stage.display.ticker', {
    id: 'smart-edu-stage-ticker',
    label: '国家平台大屏跑马灯',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduStageTicker as any }),
  });

  // 7. 课后总结：CELTS-3 学情报告导出
  store.registerExtensionPoint('classroom.post_class.exporter', {
    id: 'smart-edu-post-class-exporter',
    label: 'CELTS-3 学情报告导出',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduPostClassExporter as any }),
  });

  // 8. 全局顶栏：连通状态心跳胶囊
  store.registerExtensionPoint('header.status_pill', {
    id: 'smart-edu-header-status-pill',
    label: '国家教育云状态',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduHeaderStatusPill as any }),
  });

  // 9. 管理后台：国家平台直连看板
  store.registerExtensionPoint('admin.dashboard.card', {
    id: 'smart-edu-admin-card',
    label: '国家平台直连看板',
    pluginId: SMART_EDU_PLUGIN_ID,
    component: () => Promise.resolve({ default: SmartEduAdminCard as any }),
  });
}
