export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** 邮件通道端口（R1-4 接 SMTP；开发默认日志适配器） */
export abstract class MailPort {
  abstract send(message: MailMessage): Promise<void>;
}
