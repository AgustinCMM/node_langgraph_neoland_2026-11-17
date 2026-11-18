import { StateGraph, START, END, MessagesValue, StateSchema } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import "dotenv/config";

const MiEstado = new StateSchema({ messages: MessagesValue });   // ← del paso 6

// ... nodos del paso 7 ...
const sumar = tool(
  ({ a, b }) => {
      console.log(`[⚙️ Calculando ${a} + ${b}...]`);
      return String(a + b);
  },
  { name: "sumar", description: "Suma dos números", schema: z.object({ a: z.number(), b: z.number() }) }
);

const ia = new ChatGroq({ model: "openai/gpt-oss-20b", temperature: 0 }).bindTools([sumar]);

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

const grafo = new StateGraph(MiEstado)
    .addNode("ia", nodoIA)
    .addNode("herramientas", nodoHerramientas)
    .addEdge(START, "ia")
    .addConditionalEdges("ia", decidirCamino, ["herramientas", END])
    .addEdge("herramientas", "ia")
    .compile();

const resultado = await grafo.invoke({ messages: [new HumanMessage("¿Cuánto es 1234 + 4321?")] });

console.log("Tipos de mensaje:", resultado.messages.map((m) => m.constructor.name).join(" | "));
console.log("Respuesta:", resultado.messages[resultado.messages.length - 1].content);