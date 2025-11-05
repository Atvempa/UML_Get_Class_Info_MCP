import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

// --- Types ---
interface UmlApiResponse {
  isError: boolean;
  message: string | null;
  statusCode: number;
  data?: {
    Classes?: any[];
    Count?: number;
    SearchFiltersUsed?: any;
  } | null;
}

// --- Constants ---
const BASE_URL =
  "https://www.uml.edu/student-dashboard/api/ClassSchedule/RealTime/Search";

// --- Helpers ---
async function fetchCourseDetails(term: string, classNumber: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const params = new URLSearchParams({ term, classNumber });
    const url = `${BASE_URL}?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as UmlApiResponse;
    if (json.isError)
      throw new Error(json.message || "UML API responded with an error");
    const cls = json?.data?.Classes?.[0];
    return cls ?? null;
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
          .coerce.string()
          .regex(/^\d+$/, "term must be numeric, e.g., '3530'")
          .describe("UML term code, e.g., '3530' for 2026 Spring"),
        classNumber: z
          .coerce.string()
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
          return {
            content: [{ type: "text", text: JSON.stringify(cls, null, 2) }],
          };
        } catch (err: any) {
          const message =
            err?.name === "AbortError"
              ? "Request timed out while contacting the UML API"
              : err?.message || "Unexpected error";
          return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
          } as any;
        }
      }
    );

    // Tool: Search Courses (canonical inputs only; returns max 20 classes)
    server.tool(
      "search_courses",
      [
        "Search UML courses by:",
        "- term: numeric term code (e.g., '3530')",
        "- subjects: official subject code(s), e.g., 'COMP', 'MATH' (string or string[])",
        "- courseOfferingMode (optional): 1 | 2 | 3",
        "  1 = Undergraduate Classes",
        "  2 = Undergraduate Online & Continuing Education Classes",
        "  3 = Graduate Classes (online and on-campus)",
        "Returns the full UML API payload as JSON but truncates data.Classes to at most 20 items.",
      ].join("\n"),
      {
        term: z.coerce.string().regex(/^\d+$/, "term must be numeric, e.g., '3530'"),
        subjects: z.union([
          z.string().regex(/^[A-Z]{2,5}$/, "subject must be an uppercase code like 'COMP'"),
          z.array(
            z.string().regex(/^[A-Z]{2,5}$/, "each subject must be an uppercase code like 'COMP'")
          ),
        ]),
        courseOfferingMode: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      },
      async ({ term, subjects, courseOfferingMode }) => {
        const params = new URLSearchParams();
        params.set("term", term);

        const subjectList = Array.isArray(subjects) ? subjects : [subjects];
        for (const s of subjectList) params.append("subjects", s);

        if (typeof courseOfferingMode !== "undefined") {
          params.append("courseOfferingModes", String(courseOfferingMode));
        }

        const url = `${BASE_URL}?${params.toString()}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const json = (await res.json()) as UmlApiResponse;

          // ---- Enforce max 20 classes in the returned payload ----
          const classes = json?.data?.Classes ?? [];
          const limitedClasses = Array.isArray(classes) ? classes.slice(0, 7) : [];
          const limited: UmlApiResponse = {
            ...json,
            data: json.data
              ? {
                  ...json.data,
                  Classes: limitedClasses,
                  Count: Math.min(json.data.Count ?? classes.length, 20),
                }
              : { Classes: limitedClasses, Count: limitedClasses.length },
          };

          return {
            content: [{ type: "text", text: JSON.stringify(limited, null, 2) }],
          };
        } catch (err: any) {
          const message =
            err?.name === "AbortError"
              ? "Request timed out while contacting the UML API"
              : err?.message || "Unexpected error";
          return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
          } as any;
        } finally {
          clearTimeout(timeout);
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
        search_courses: {
          description:
            "Search UML courses by term, official subject codes, and optional courseOfferingMode (1|2|3). Returns full payload but truncates to 20 classes.",
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
