import { Global, Module } from "@nestjs/common";
import { CryptoService } from "./crypto/crypto.service";
import { CodeGeneratorService } from "./codegen/code-generator.service";
import { AuditService } from "./audit/audit.service";
import { OutboxService } from "./outbox/outbox.service";
import { OutboxDispatcher } from "./outbox/outbox.dispatcher";
import { StateMachineService } from "./state-machine/state-machine.service";
import { PiiFilterService } from "./pii/pii-filter.service";

@Global()
@Module({
  providers: [
    CryptoService,
    CodeGeneratorService,
    AuditService,
    OutboxService,
    OutboxDispatcher,
    StateMachineService,
    PiiFilterService,
  ],
  exports: [CryptoService, CodeGeneratorService, AuditService, OutboxService, StateMachineService, PiiFilterService],
})
export class KernelModule {}
