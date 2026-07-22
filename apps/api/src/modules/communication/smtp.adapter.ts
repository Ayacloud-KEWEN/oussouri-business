import { Logger } from "@nestjs/common";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { MailPort, type MailMessage } from "./mail.port";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** 465 直连 TLS；587/25 走 STARTTLS */
  secure: boolean;
}

/** RFC 2047：非 ASCII 主题需编码，否则中文/法文主题会乱码 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** RFC 5321 §4.5.2：行首单独的点需转义，否则会被当作数据结束符 */
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

/**
 * SMTP 邮件适配器（R1-4）：零依赖手写客户端，与项目既有风格一致
 * （SigV4、TOTP 亦为手写）。支持隐式 TLS(465) 与 STARTTLS(587)，AUTH LOGIN。
 * 仅需发送简单正文邮件（无附件），协议子集足够。
 */
export class SmtpMailAdapter extends MailPort {
  private readonly logger = new Logger(SmtpMailAdapter.name);

  constructor(private readonly config: SmtpConfig) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    const socket = await this.openSocket();
    try {
      await this.expect(socket, 220);
      await this.cmd(socket, `EHLO ${this.hostname()}`, 250);

      if (!this.config.secure) {
        await this.cmd(socket, "STARTTLS", 220);
        const upgraded = await this.upgradeTls(socket);
        return await this.sendOverSecure(upgraded, message);
      }
      return await this.sendAuthenticated(socket, message);
    } finally {
      socket.destroy();
    }
  }

  private async sendOverSecure(socket: TLSSocket, message: MailMessage): Promise<void> {
    try {
      await this.cmd(socket, `EHLO ${this.hostname()}`, 250);
      await this.sendAuthenticated(socket, message);
    } finally {
      socket.destroy();
    }
  }

  private async sendAuthenticated(socket: Socket | TLSSocket, message: MailMessage): Promise<void> {
    await this.cmd(socket, "AUTH LOGIN", 334);
    await this.cmd(socket, Buffer.from(this.config.user, "utf8").toString("base64"), 334);
    await this.cmd(socket, Buffer.from(this.config.pass, "utf8").toString("base64"), 235);
    await this.cmd(socket, `MAIL FROM:<${this.extractAddress(this.config.from)}>`, 250);
    await this.cmd(socket, `RCPT TO:<${this.extractAddress(message.to)}>`, [250, 251]);
    await this.cmd(socket, "DATA", 354);
    await this.cmd(socket, `${this.buildMime(message)}\r\n.`, 250);
    await this.cmd(socket, "QUIT", [221, 250]).catch(() => undefined);
    this.logger.log(`mail sent to=${message.to} subject=${message.subject}`);
  }

  private buildMime(message: MailMessage): string {
    const boundary = `b${Date.now().toString(36)}`;
    const headers = [
      `From: ${this.config.from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
    ];
    if (!message.html) {
      headers.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit");
      return `${headers.join("\r\n")}\r\n\r\n${dotStuff(message.text)}`;
    }
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(message.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(message.html),
      `--${boundary}--`,
    ];
    return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  }

  private openSocket(): Promise<Socket | TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = this.config.secure
        ? tlsConnect({ host: this.config.host, port: this.config.port, servername: this.config.host })
        : netConnect({ host: this.config.host, port: this.config.port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("SMTP 连接超时")); }, 15_000);
      socket.once(this.config.secure ? "secureConnect" : "connect", () => { clearTimeout(timer); resolve(socket); });
      socket.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  private upgradeTls(socket: Socket): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      const secure = tlsConnect({ socket, servername: this.config.host }, () => resolve(secure));
      secure.once("error", reject);
    });
  }

  /** 发送指令并校验响应码 */
  private async cmd(socket: Socket | TLSSocket, command: string, expected: number | number[]): Promise<string> {
    socket.write(`${command}\r\n`);
    return this.expect(socket, expected);
  }

  private expect(socket: Socket | TLSSocket, expected: number | number[]): Promise<string> {
    const codes = Array.isArray(expected) ? expected : [expected];
    return new Promise((resolve, reject) => {
      let buffer = "";
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`SMTP 响应超时（期待 ${codes.join("/")}）`)); }, 15_000);
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // 多行响应以 "250 " 形式的最后一行结束（第 4 位为空格而非连字符）
        const lines = buffer.split("\r\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (!last || /^\d{3}-/.test(last)) return;
        cleanup();
        const code = Number(last.slice(0, 3));
        if (codes.includes(code)) resolve(buffer);
        else reject(new Error(`SMTP 期待 ${codes.join("/")}，实际 ${last}`));
      };
      const onError = (err: Error) => { cleanup(); reject(err); };
      socket.on("data", onData);
      socket.once("error", onError);
    });
  }

  private extractAddress(value: string): string {
    const match = value.match(/<([^>]+)>/);
    return (match?.[1] ?? value).trim();
  }

  private hostname(): string {
    return process.env.SMTP_EHLO_NAME ?? "oussouri.com";
  }
}
