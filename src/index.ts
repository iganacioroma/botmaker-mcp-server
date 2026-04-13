#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import express, { Request, Response } from "express";

const BOTMAKER_TOKEN = process.env.BOTMAKER_TOKEN ?? "";
const BASE_V1 = "https://go.botmaker.com/api/v1.0";
const BASE_V2 = "https://api.botmaker.com/v2.0";
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
  const server = new McpServer({ name: "botmaker-mcp-server", version: "1.0.0" });

  server.registerTool("botmaker_list_intents", {
    title: "Listar intenciones del bot",
    description: "Lista todas las intenciones/reglas configuradas en el bot de Botmaker con IDs, nombres y estado.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try {
      const data = await apiGet<unknown>(`${BASE_V1}/intent/list`);
      const items: any[] = Array.isArray(data) ? data : ((data as any)?.items ?? [data]);
      return { content: [{ type: "text", text: toJson({ total: items.length, intents: items.map((i: any) => ({ id: i.id ?? i._id, name: i.name ?? i.intentName, description: i.description ?? "", enabled: i.enabled ?? true })) }) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_intent", {
    title: "Ver detalle de una intención",
    description: "Obtiene detalle completo de una intención: patrones, respuestas, acciones y variables.\nArgs:\n- intent_id: ID de la intención",
    inputSchema: z.object({ intent_id: z.string().min(1).describe("ID de la intención") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ intent_id }) => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/intent/${intent_id}`)) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_list_customers", {
    title: "Listar contactos",
    description: "Lista contactos registrados en Botmaker.\nArgs:\n- limit: máx resultados (default 20)\n- offset: paginación (default 0)",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ limit, offset }) => {
    try {
      const data = await apiGet<unknown>(`${BASE_V1}/customer/list`, { limit, offset });
      const items: any[] = Array.isArray(data) ? data : ((data as any)?.items ?? []);
      return { content: [{ type: "text", text: toJson({ total_returned: items.length, has_more: items.length === limit, customers: items.map((c: any) => ({ id: c.id ?? c._id, name: c.name ?? c.displayName, phone: c.phone ?? "", email: c.email ?? "", platform: c.platform ?? "" })) }) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_customer", {
    title: "Ver detalle de un contacto",
    description: "Obtiene información completa de un contacto.\nArgs:\n- customer_id: ID del contacto",
    inputSchema: z.object({ customer_id: z.string().min(1).describe("ID del contacto") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ customer_id }) => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/customer/${customer_id}`)) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_check_whatsapp", {
    title: "Verificar número de WhatsApp",
    description: "Verifica si un número tiene WhatsApp activo.\nArgs:\n- phone: número con código de país sin +. Ej: 5491112345678",
    inputSchema: z.object({ phone: z.string().min(6).describe("Ej: 5491112345678") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ phone }) => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/customer/checkWhatsAppContact`, { phone })) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_list_conversations", {
    title: "Listar conversaciones recientes",
    description: "Lista conversaciones recientes.\nArgs:\n- limit: máx (default 20)\n- offset: paginación (default 0)",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ limit, offset }) => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V2}/messages`, { limit, offset })) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_chat_history", {
    title: "Ver historial de chat",
    description: "Obtiene historial de mensajes de un contacto.\nArgs:\n- customer_id: ID del contacto",
    inputSchema: z.object({ customer_id: z.string().min(1).describe("ID del contacto") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ customer_id }) => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/message/list/${customer_id}`)) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_send_message", {
    title: "Enviar mensaje a un usuario",
    description: "Envía un mensaje real a un usuario. ⚠️ Acción real.\nArgs:\n- customer_id: ID destinatario\n- platform: whatsapp/instagram/messenger/webchat\n- message: texto",
    inputSchema: z.object({ customer_id: z.string().min(1), platform: z.string().min(1), message: z.string().min(1).max(4000) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ customer_id, platform, message }) => {
    try { return { content: [{ type: "text", text: toJson(await apiPost<unknown>(`${BASE_V1}/message/v3`, { chatPlatform: platform, chatChannelNumber: customer_id, messageText: message })) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_trigger_intent", {
    title: "Disparar una intención",
    description: "Activa una intención del bot para testear.\nArgs:\n- intent_id: ID de la intención",
    inputSchema: z.object({ intent_id: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ intent_id }) => {
    try { return { content: [{ type: "text", text: toJson(await apiPost<unknown>(`${BASE_V1}/intent/v2`, { intentId: intent_id })) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_get_account_info", {
    title: "Ver info de la cuenta",
    description: "Obtiene información general de la cuenta Botmaker.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/account`)) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  server.registerTool("botmaker_list_channels", {
    title: "Listar canales configurados",
    description: "Lista todos los canales configurados: WhatsApp, Instagram, Messenger, webchat, etc.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try { return { content: [{ type: "text", text: toJson(await apiGet<unknown>(`${BASE_V1}/channel/list`)) }] };
    } catch (e) { return { content: [{ type: "text", text: handleError(e) }] }; }
  });

  return server;
}

async function main() {
  if (!BOTMAKER_TOKEN) { console.error("❌ ERROR: BOTMAKER_TOKEN no configurado."); process.exit(1); }

  const app = express();
  app.use(express.json());

  // HEAD y GET en /mcp — requerido por Claude.ai para protocol discovery
  app.head("/mcp", (_req: Request, res: Response) => {
    res.setHeader("MCP-Protocol-Version", "2025-03-26");
    res.setHeader("Allow", "GET, POST, HEAD");
    res.status(200).end();
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.setHeader("MCP-Protocol-Version", "2025-03-26");
    res.status(405).setHeader("Allow", "POST").json({ error: "Use POST to connect to this MCP server" });
  });

  // POST /mcp — endpoint principal
  app.post("/mcp", async (req: Request, res: Response) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "botmaker-mcp-server", version: "1.0.0" });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "botmaker-mcp-server", mcp_endpoint: "/mcp", health: "/health" });
  });

  const port = parseInt(process.env.PORT ?? "3000");
  app.listen(port, () => {
    console.error(`✅ Botmaker MCP Server corriendo en puerto ${port}`);
  });
}

main().catch((err) => { console.error("Error fatal:", err); process.exit(1); });
