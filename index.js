import { StateGraph, START, END, MessagesValue, StateSchema, MemorySaver } from "@langchain/langgraph"; // LangGraph: plano, estado y memoria
import { HumanMessage } from "@langchain/core/messages"; // LangChain: "esto lo dijo una persona"
import { ChatGroq } from "@langchain/groq";              // LangChain: enchufe con Groq
import { tool } from "@langchain/core/tools";            // LangChain: envoltorio de herramientas
import { z } from "zod";                                 // Describe la forma de los datos
import { WebSocketServer } from "ws";                    // La ventanilla web
import "dotenv/config";                                  // Carga GROQ_API_KEY del .env

// 1. ESTADO: una carpeta con un cajón "messages" que se va acumulando
const MiEstado = new StateSchema({ messages: MessagesValue });

// 2. HERRAMIENTA: la calculadora
const sumar = tool(
  ({ a, b }) => {
      console.log(`[⚙️ Calculando ${a} + ${b}...]`);
      return String(a + b);
  },
  { name: "sumar", description: "Suma dos números", schema: z.object({ a: z.number(), b: z.number() }) }
);

// 3. IA que conoce la calculadora
const ia = new ChatGroq({ model: "openai/gpt-oss-20b", temperature: 0 }).bindTools([sumar]);

// 4. NODOS Y DECISIÓN
async function nodoIA(estado) { return { messages: [await ia.invoke(estado.messages)] }; }
async function nodoHerramientas(estado) {
    const ultimoMensaje = estado.messages[estado.messages.length - 1];
    const resultados = [];
    for (const peticion of ultimoMensaje.tool_calls || []) {
        if (peticion.name === "sumar") resultados.push(await sumar.invoke(peticion));
    }
    return { messages: resultados };
}
function decidirCamino(estado) {
    const ultimoMensaje = estado.messages[estado.messages.length - 1];
    if (ultimoMensaje.tool_calls && ultimoMensaje.tool_calls.length > 0) return "herramientas";
    return END;
}

// 5. GRAFO con memoria
const memoria = new MemorySaver();
const grafo = new StateGraph(MiEstado)
    .addNode("ia", nodoIA)
    .addNode("herramientas", nodoHerramientas)
    .addEdge(START, "ia")
    .addConditionalEdges("ia", decidirCamino, ["herramientas", END])
    .addEdge("herramientas", "ia")
    .compile({ checkpointer: memoria });

// 6. SERVIDOR WEBSOCKET
const wss = new WebSocketServer({ port: 8080 });

console.log("=========================================");
console.log("🌐 Servidor LangGraph escuchando en ws://localhost:8080");
console.log("=========================================\n");

wss.on("connection", (ws) => {
    console.log("🟢 Nuevo cliente conectado.");
    ws.send("¡Hola! Soy tu asistente de IA. ¿En qué te ayudo?");

    ws.on("message", async (mensaje) => {
        const textoUsuario = mensaje.toString();
        console.log(`👤 Usuario dice: ${textoUsuario}`);

        try {
            const config = { configurable: { thread_id: "cliente_web_1" } };
            const resultado = await grafo.invoke({ messages: [new HumanMessage(textoUsuario)] }, config);
            const respuestaIA = resultado.messages[resultado.messages.length - 1].content;
            ws.send(respuestaIA);
        } catch (error) {
            console.error("Error:", error.message);
            ws.send("Hubo un error al procesar tu mensaje.");
        }
    });

    ws.on("close", () => console.log("🔴 Cliente desconectado."));
});