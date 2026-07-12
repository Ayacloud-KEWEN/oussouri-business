import { Module } from "@nestjs/common";
import { CommunicationService } from "./communication.service";
import { CommunicationController } from "./communication.controller";
import { RiskController } from "./risk.controller";
import { MailPort } from "./mail.port";
import { LogMailAdapter } from "./mail.adapters";
import { NotificationGateway } from "./notification.gateway";

@Module({
  controllers: [CommunicationController, RiskController],
  providers: [
    CommunicationService,
    NotificationGateway,
    // R1-4 接 SMTP 后改为按 SMTP_* 配置切换适配器
    { provide: MailPort, useClass: LogMailAdapter },
  ],
  exports: [CommunicationService, MailPort],
})
export class CommunicationModule {}
