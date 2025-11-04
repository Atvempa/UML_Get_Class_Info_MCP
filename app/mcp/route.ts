import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

// --- Types ---
interface UmlApiResponse {
  isError: boolean;
  message: string | null;
  statusCode: number;
  data?: {
    Classes?: any[];
  } | null;
}

// --- Utilities ---
const BASE_URL =
  "https://www.uml.edu/student-dashboard/api/ClassSchedule/RealTime/Search";

async function fetchCourseDetails(term: string, classNumber: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const params = new URLSearchParams({ term, classNumber });
    const url = `${BASE_URL}?${params.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "accept": "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as UmlApiResponse;

    if (json.isError) {
      throw new Error(json.message || "UML API responded with an error");
    }

    const cls = json?.data?.Classes?.[0];
    if (!cls) {
      return null;
    }
    return cls;
  } finally {
    clearTimeout(timeout);
  }
}

// --- MCP Handler ---
const handler = createMcpHandler(
  (server) => {
    // Tool: Get Course Details for a given term & class number
    server.tool(
      "get_course_details",
      "Fetch detailed class information from UML for the given term and class number.",
      {
        term: z
          .string()
          .regex(/^\d+$/, "term must be numeric, e.g., '3530'")
          .describe("UML term code, e.g., '3530' for 2026 Spring"),
        classNumber: z
          .union([z.string(), z.number()])
          .transform((v) => String(v))
          .regex(/^\d+$/, "classNumber must be numeric, e.g., '9670'")
          .describe("UML class number, e.g., '9670'"),
      },
      async ({ term, classNumber }) => {
        try {
          const cls = await fetchCourseDetails(term, classNumber);

          if (!cls) {
            return {
              content: [
                {
                  type: "text",
                  text: `No class found for term=${term} and classNumber=${classNumber}.`,
                },
              ],
            };
          }

          // Prefer JSON content (if the client supports it); also include a text echo for resilience
          return {
            content: [
              // @ts-ignore – some MCP clients support a structured JSON part
              { type: "json", json: cls },
              { type: "text", text: JSON.stringify(cls) },
            ],
          };
        } catch (err: any) {
          const message = err?.name === "AbortError"
            ? "Request timed out while contacting the UML API"
            : err?.message || "Unexpected error";

          return {
            content: [
              { type: "text", text: `Error: ${message}` },
            ],
            isError: true,
          } as any;
        }
      }
    );
  },
  {
    capabilities: {
      tools: {
        get_course_details: {
          description:
            "Fetch detailed class information from UML for the given term and class number.",
        },
      },
    },
  },
  {
    redisUrl: process.env.REDIS_URL,
    basePath: "",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
