/**
 * 国家智慧教育平台前端共享类型。
 *
 * SmartEduStatus 与后端 smart_edu.get_status 的真实返回对齐：
 * 未配置网关时 configured=false，connected 恒为 false——绝不虚构健康状态
 * （v0.6.0 审计 C-4：此前恒报 connected:true / rtt 16ms / 伪造证书有效期）。
 */

export interface SmartEduCourseResource {
  id: string;
  code: string;
  title: string;
  /** 字段以国家平台网关实际返回为准，未知取值原样透传（不枚举、不编造） */
  subject: string;
  grade: string;
  edition: string;
  awardLevel: string;
  teacherName: string;
  schoolName: string;
  summary: string;
  tags: string[];
  coverGradient?: string;
  timeline: Array<{
    id: string;
    title: string;
    type: string;
    duration: number;
    description: string;
  }>;
  whiteboardElements?: Array<{
    type: string;
    data: Record<string, any>;
  }>;
}

export interface SmartEduStatus {
  success: boolean;
  /** 服务端是否配置了国家平台网关地址（SMARTEDU_API_BASE） */
  configured: boolean;
  /** 网关真实探测结果（未配置时恒为 false） */
  connected: boolean;
  endpoint?: string;
  rttMs?: number;
  channelStatus?: string;
  syncedCoursesCount?: number;
  lastHeartbeat?: string;
  error?: string;
}
