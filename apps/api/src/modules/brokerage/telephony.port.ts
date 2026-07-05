import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";

export interface CallResult {
  providerCallId: string;
}

/** 电话端口（架构 A6 / 决策 D4）：默认 Twilio，可替换；Broker 永不接触明文号码 */
export abstract class TelephonyPort {
  /** 双向桥接：先呼 Broker 工作号，再桥接目标号码（号码仅在服务端内存中出现） */
  abstract createBridgedCall(targetPhone: string, metadata: Record<string, string>): Promise<CallResult>;
}

/** 开发/测试假适配器（占位凭据时启用） */
@Injectable()
export class FakeTelephonyAdapter extends TelephonyPort {
  private readonly logger = new Logger(FakeTelephonyAdapter.name);

  async createBridgedCall(targetPhone: string, metadata: Record<string, string>): Promise<CallResult> {
    // 日志只输出掩码号码（GBR-1：任何输出通道不落明文）
    const masked = targetPhone.slice(0, 4) + "****" + targetPhone.slice(-2);
    this.logger.log(`[FAKE] bridged call → ${masked} (opp=${metadata.opportunityCode ?? "-"})`);
    return { providerCallId: `CA_fake_${randomBytes(8).toString("hex")}` };
  }
}

/** Twilio REST 适配器（生产；状态回调 → /v1/webhooks/twilio/call-status） */
@Injectable()
export class TwilioRestAdapter extends TelephonyPort {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly statusCallbackUrl: string,
  ) {
    super();
  }

  async createBridgedCall(targetPhone: string, metadata: Record<string, string>): Promise<CallResult> {
    const params = new URLSearchParams({
      To: targetPhone,
      From: this.fromNumber,
      Twiml: `<Response><Say language="fr-FR">Oussouri Caviar HUB</Say><Pause length="1"/></Response>`,
      StatusCallback: this.statusCallbackUrl,
      StatusCallbackEvent: "completed",
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok || !json.sid) throw new Error(`Twilio call failed: ${json.message ?? res.status}`);
    return { providerCallId: json.sid };
  }
}
