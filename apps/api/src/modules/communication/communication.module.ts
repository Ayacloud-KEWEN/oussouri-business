import { Module } from "@nestjs/common";
import { CommunicationService } from "./communication.service";
import { CommunicationController } from "./communication.controller";
import { MailPort } from "./mail.port";
import { LogMailAdapter } from "./mail.adapters";

@Module({
  controllers: [CommunicationController],
  providers: [
    CommunicationService,
    // R1-4 接 SMTP 后改为按 SMTP_* 配置切换适配器
    { provide: MailPort, useClass: LogMailAdapter },
  ],
  exports: [CommunicationService, MailPort],
})
export class CommunicationModule {}
