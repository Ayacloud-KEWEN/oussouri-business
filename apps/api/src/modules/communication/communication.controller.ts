import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { CommunicationService } from "./communication.service";
import { CurrentUser } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CreateConversationDto {
  @IsIn(["PRODUCT", "ORDER", "RFQ", "OPPORTUNITY", "SUPPORT"]) topicType!: string;
  @IsOptional() @IsUUID() topicId?: string;
}

class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

@Controller()
export class CommunicationController {
  constructor(private readonly comm: CommunicationService) {}

  @Post("conversations")
  create(@Body() dto: CreateConversationDto, @CurrentUser() user: JwtPayload) {
    return this.comm.createConversation(dto.topicType, dto.topicId, user);
  }

  @Post("conversations/:id/messages")
  send(@Param("id") id: string, @Body() dto: SendMessageDto, @CurrentUser() user: JwtPayload) {
    return this.comm.sendMessage(id, dto.body, user);
  }

  @Get("conversations/:id/messages")
  list(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.comm.listMessages(id, user);
  }

  @Get("notifications")
  notifications(@CurrentUser() user: JwtPayload) {
    return this.comm.myNotifications(user);
  }

  @Post("notifications/:id/read")
  markRead(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.comm.markRead(id, user);
  }
}
