import { Global, Module } from "@nestjs/common";
import { CryptoService } from "./crypto/crypto.service";
import { CodeGeneratorService } from "./codegen/code-generator.service";
import { AuditService } from "./audit/audit.service";
import { OutboxService } from "./outbox/outbox.service";
import { OutboxDispatcher } from "./outbox/outbox.dispatcher";
import { StateMachineService } from "./state-machine/state-machine.service";
import { PiiFilterService } from "./pii/pii-filter.service";
import { VisibilityService } from "./visibility/visibility.service";
import { VisibilityController } from "./visibility/visibility.controller";
import { AuditController } from "./audit/audit.controller";

@Global()
@Module({
  controllers: [VisibilityController, AuditController],
  providers: [
    CryptoService,
    CodeGeneratorService,
    AuditService,
    OutboxService,
    OutboxDispatcher,
    StateMachineService,
    PiiFilterService,
    VisibilityService,
  ],
  exports: [CryptoService, CodeGeneratorService, AuditService, OutboxService, StateMachineService, PiiFilterService, VisibilityService],
})
export class KernelModule {}
