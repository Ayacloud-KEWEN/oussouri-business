import { Logger } from "@nestjs/common";
import { MailPort, type MailMessage } from "./mail.port";

/** 开发/演示环境：邮件内容打日志，不外发 */
export class LogMailAdapter extends MailPort {
  private readonly logger = new Logger("Mail");

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`[DEV MAIL] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
