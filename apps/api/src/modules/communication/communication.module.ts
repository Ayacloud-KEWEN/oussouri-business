import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommunicationService } from "./communication.service";
import { CommunicationController } from "./communication.controller";
import { RiskController } from "./risk.controller";
import { MailPort } from "./mail.port";
import { LogMailAdapter } from "./mail.adapters";
import { SmtpMailAdapter } from "./smtp.adapter";
import { NotificationGateway } from "./notification.gateway";

@Module({
  controllers: [CommunicationController, RiskController],
  providers: [
    CommunicationService,
    NotificationGateway,
    {
      provide: MailPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailPort => {
        // 支持两种配置方式：分项 SMTP_HOST/USER/PASS，或 .env 模板里的 SMTP_URL
        const url = config.get<string>("SMTP_URL") ?? "";
        let host = config.get<string>("SMTP_HOST") ?? "";
        let user = config.get<string>("SMTP_USER") ?? "";
        let pass = config.get<string>("SMTP_PASS") ?? "";
        let urlPort = 0;
        if (!host && url && !url.includes("smtp.example.com")) {
          try {
            const parsed = new URL(url);
            host = parsed.hostname;
            user = decodeURIComponent(parsed.username);
            pass = decodeURIComponent(parsed.password);
            urlPort = parsed.port ? Number(parsed.port) : 0;
          } catch {
            /* 配置串格式错误 → 落回日志适配器 */
          }
        }
        const from = config.get<string>("SMTP_FROM") ?? user;
        // 缺配置或仍是占位值 → 日志适配器（开发默认）
        const placeholder = [host, user, pass].some((v) => !v || v === "xxx" || v === "user" || v === "pass");
        if (placeholder) {
          if (config.get("NODE_ENV") === "production") {
            new Logger("Mail").warn("生产环境未配置 SMTP_*，邮件仅写日志：忘记密码等邮件用户收不到");
          }
          return new LogMailAdapter();
        }
        const port = Number(config.get<string>("SMTP_PORT") ?? urlPort ?? 0) || urlPort || 587;
        return new SmtpMailAdapter({ host, port, user, pass, from, secure: port === 465 });
      },
    },
  ],
  exports: [CommunicationService, MailPort],
})
export class CommunicationModule {}
