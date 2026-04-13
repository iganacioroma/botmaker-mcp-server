#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import express, { Request, Response } from "express";

const BOTMAKER_TOKEN = process.env.BOTMAKER_TOKEN ?? "";
const BASE = "https://api.botmaker.com/v2.0";
const TIMEOUT_MS = 20_000;

function headers(): Record<string, string> {
  return { "access-token": BOTMAKER_TOKEN, "Content-Type": "application/json", "Accept": "application/json" };
}
async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const r = await axios.get<T>(url, { headers: headers(), params, timeout: TIMEOUT_MS });
  return r.data;
}
async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const r = await axios.post<T>(url, body, { headers: headers(), timeout: TIMEOUT_MS });
  return r.data;
}
function handleError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (!error.response) return `Error de conexión: ${error.message}`;
    const s = error.response.status;
    if (s === 401) return "Error 401: Token inválido o expirado.";
    if (s === 403) return "Error 403: Sin permisos o saldo insuficiente.";
    if (s === 404) return "Error 404: Recurso no encontrado.";
    if (s === 429) return "Error 429: Rate limit. Esperá unos segundos.";
    return `Error HTTP ${s}: ${JSON.stringify(error.response.data ?? "").slice(0, 300)}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
function toJson(data: unknown): string { return JSON.stringify(data, null, 2); }

function makeServer(): McpServer {
  const server = new McpServer({ name: "botmaker-mcp-server", version: "2.0.0" });

  // ── INTENTS ──────────────────────────────────────────────
  server.registerTool("botmaker_list_intents", {
    title: "Listar intenciones del bot",
    description: "Lista todas las intenciones del bot. Devuelve páginas de 200; si hay más, el campo nextPage trae la URL de la siguiente página.",
    inputSchema: z.object({
      nextPage: z.string().optional().describe("URL de la siguiente página (del campo nextPage de la respuesta anterior)")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ nextPage }) => {
    try {
      const url = nextPage ?? `${BASE}/intents`;
      const data = await apiGet<unknown>(url);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_intent", {
    title: "Ver detalle de una intención",
    description: "Obtiene el detalle completo de una intención por ID o nombre.\nArgs:\n- idOrName: ID o nombre de la intención",
    inputSchema: z.object({
      idOrName: z.string().min(1).describe("ID o nombre de la intención")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ idOrName }) => {
    try {
      const data = await apiGet<unknown>(`${BASE}/intents/${encodeURIComponent(idOrName)}`);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_trigger_intent", {
    title: "Disparar una intención",
    description: "Dispara una intención o template de WhatsApp en un chat específico.\nArgs:\n- channelId: ID del canal (ej: botproject-whatsapp-5491147038xxx)\n- contactId: teléfono del contacto (ej: 5491147038xxx)\n- intentIdOrName: ID o nombre de la intención\n- variables: variables opcionales { varName: value }\n- tags: tags opcionales { tagName: true }",
    inputSchema: z.object({
      channelId: z.string().min(1).describe("ID del canal (ej: botproject-whatsapp-5491147038xxx)"),
      contactId: z.string().min(1).describe("Teléfono del contacto (ej: 5491147038xxx)"),
      intentIdOrName: z.string().min(1).describe("ID o nombre de la intención"),
      variables: z.record(z.string()).optional().describe("Variables opcionales"),
      tags: z.record(z.boolean()).optional().describe("Tags opcionales"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ channelId, contactId, intentIdOrName, variables, tags }) => {
    try {
      const body: any = { chat: { channelId, contactId }, intentIdOrName };
      if (variables) body.variables = variables;
      if (tags) body.tags = tags;
      const data = await apiPost<unknown>(`${BASE}/chats-actions/trigger-intent`, body);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  // ── CHATS ─────────────────────────────────────────────────
  server.registerTool("botmaker_list_chats", {
    title: "Listar y buscar chats",
    description: "Lista o busca chats ordenados por última actividad. Máx 250 por request.\nArgs opcionales:\n- channelId: filtrar por canal\n- contactId: teléfono (requiere channelId)\n- name: nombre del contacto\n- from/to: rango de fechas ISO8601\n- nextPage: URL de la página siguiente",
    inputSchema: z.object({
      channelId: z.string().optional().describe("ID del canal"),
      contactId: z.string().optional().describe("Teléfono del contacto"),
      name: z.string().optional().describe("Nombre del contacto"),
      from: z.string().optional().describe("Fecha desde (ISO8601, ej: 2024-01-01T00:00:00Z)"),
      to: z.string().optional().describe("Fecha hasta (ISO8601)"),
      nextPage: z.string().optional().describe("URL de la siguiente página"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ channelId, contactId, name, from, to, nextPage }) => {
    try {
      const url = nextPage ?? `${BASE}/chats`;
      const params: Record<string, string> = {};
      if (channelId) params["channel-id"] = channelId;
      if (contactId) params["contact-id"] = contactId;
      if (name) params["name"] = name;
      if (from) params["from"] = from;
      if (to) params["to"] = to;
      const data = await apiGet<unknown>(url, Object.keys(params).length ? params : undefined);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_chat", {
    title: "Ver detalle de un chat",
    description: "Obtiene el estado de un chat. Solo chats con actividad de menos de 2 meses.\nArgs:\n- chatReference: chatId, o 'channelId:contactId' (ej: botproject-whatsapp-xxx:5491147038xxx), o externalId",
    inputSchema: z.object({
      chatReference: z.string().min(1).describe("chatId, o channelId:contactId, o externalId")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ chatReference }) => {
    try {
      const data = await apiGet<unknown>(`${BASE}/chats/${encodeURIComponent(chatReference)}`);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  // ── MESSAGES ──────────────────────────────────────────────
  server.registerTool("botmaker_list_messages", {
    title: "Ver historial de mensajes",
    description: "Historial de mensajes de todos los chats o de uno específico. Máx 1000 por página.\nArgs opcionales:\n- chatId: ID del chat específico\n- channelId + contactId: alternativa al chatId\n- from/to: rango de fechas ISO8601\n- limit: entre 250 y 1500 (default 250)\n- platform: whatsapp, messenger, webchat, etc.",
    inputSchema: z.object({
      chatId: z.string().optional().describe("chatId de Botmaker"),
      channelId: z.string().optional().describe("ID del canal"),
      contactId: z.string().optional().describe("Teléfono del contacto"),
      from: z.string().optional().describe("Fecha desde (ISO8601)"),
      to: z.string().optional().describe("Fecha hasta (ISO8601)"),
      limit: z.number().int().min(250).max(1500).default(250).optional().describe("Cantidad de mensajes (250-1500)"),
      platform: z.string().optional().describe("whatsapp, messenger, webchat, telegram, etc."),
      nextPage: z.string().optional().describe("URL de la siguiente página"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ chatId, channelId, contactId, from, to, limit, platform, nextPage }) => {
    try {
      const url = nextPage ?? `${BASE}/messages`;
      const params: Record<string, string> = {};
      if (chatId) params["chat-id"] = chatId;
      if (channelId) params["channel-id"] = channelId;
      if (contactId) params["contact-id"] = contactId;
      if (from) params["from"] = from;
      if (to) params["to"] = to;
      if (limit) params["limit"] = String(limit);
      if (platform) params["chat-platform"] = platform;
      const data = await apiGet<unknown>(url, Object.keys(params).length ? params : undefined);
      return { content: [{ type: "text", text: toJson(data) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  return server;
}

async function main() {
  if (!BOTMAKER_TOKEN) { console.error("❌ ERROR: BOTMAKER_TOKEN no configurado."); process.exit(1); }
  const app = express();
  app.use(express.json());

  app.head("/mcp", (_req: Request, res: Response) => {
    res.setHeader("MCP-Protocol-Version", "2025-03-26");
    res.setHeader("Allow", "GET, POST, HEAD");
    res.status(200).end();
  });
  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).setHeader("Allow", "POST").json({ error: "Use POST to connect" });
  });
  app.post("/mcp", async (req: Request, res: Response) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "botmaker-mcp-server", version: "2.0.0" });
  });
  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "botmaker-mcp-server", mcp_endpoint: "/mcp", health: "/health" });
  });

  const port = parseInt(process.env.PORT ?? "3000");
  app.listen(port, () => { console.error(`✅ Botmaker MCP Server v2 corriendo en puerto ${port}`); });
}

main().catch((err) => { console.error("Error fatal:", err); process.exit(1); });
