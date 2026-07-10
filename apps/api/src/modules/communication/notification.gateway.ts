import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { ACCESS_COOKIE, readCookie } from "../iam/auth-cookies";
import type { JwtPayload } from "../iam/auth.types";

const WS_PATH = "/v1/ws";

/**
 * 通知实时推送（M16 增强）：原生 ws 挂在 Nest HTTP 服务器的 upgrade 事件上。
 * 鉴权：升级请求带 httpOnly access cookie（浏览器）或 ?token=（脚本）。
 * 生产 Nginx 已配置 Upgrade 头透传（部署手册 §vhost）。
 */
@Injectable()
export class NotificationGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("NotificationGateway");
  private wss?: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (!server) return; // 测试环境无 HTTP 服务器
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.handleUpgrade(req, socket, head);
    });
  }

  onModuleDestroy(): void {
    this.wss?.clients.forEach((ws) => ws.terminate());
    this.wss?.close();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const token = readCookie(req, ACCESS_COOKIE) ?? url.searchParams.get("token") ?? undefined;
    let payload: JwtPayload;
    try {
      if (!token) throw new Error("missing token");
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss!.handleUpgrade(req, socket, head, (ws) => {
      const userId = payload.sub;
      let set = this.clients.get(userId);
      if (!set) {
        set = new Set();
        this.clients.set(userId, set);
      }
      set.add(ws);
      ws.on("close", () => {
        set!.delete(ws);
        if (set!.size === 0) this.clients.delete(userId);
      });
      ws.on("error", (err) => this.logger.warn(`ws error user=${userId}: ${err.message}`));
    });
  }

  /** 向某用户的全部在线连接推送一条事件（无连接则静默） */
  push(userId: string, event: Record<string, unknown>): void {
    const sockets = this.clients.get(userId);
    if (!sockets) return;
    const data = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
}
