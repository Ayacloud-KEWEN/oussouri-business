import { Module } from "@nestjs/common";
import { CertExpiryService } from "./cert-expiry.service";
import { GdprService } from "./gdpr.service";
import { ComplianceController } from "./compliance.controller";
import { CommunicationModule } from "../communication/communication.module";

/** 合规运营（M12）：证照到期扫描（R1-5）、GDPR 数据主体请求（R1-7） */
@Module({
  imports: [CommunicationModule],
  controllers: [ComplianceController],
  providers: [CertExpiryService, GdprService],
  exports: [CertExpiryService, GdprService],
})
export class ComplianceModule {}
